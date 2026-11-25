import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import { calcularEstadia, conferirPagamentos } from '@estacionamento/calculo';
import {
  formatarCentavos,
  formatarPlaca,
  normalizarPlaca,
  type PedidoEntrada,
  type PedidoPagamento,
  type ResultadoPagamento,
  type PedidoPreviaSaida,
  type PreviaSaida,
  type PedidoSaida,
  type ReciboSaida,
  type ResultadoEntrada,
  type SessaoDetalhe,
} from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import type { Conexao } from '../../db/pool.js';
import { comTransacao, type ContextoAuditoria } from '../../db/transacao.js';
import { AppError, erros } from '../../http/erros.js';
import { nivelDosPerfis, type Autenticacao } from '../auth/auth.service.js';
import { carregarConfig } from '../configuracoes/preferencias.js';
import { publicarDisponibilidade, publicarTicket } from '../../sync/outbox.js';
import { exigirVeiculoForaDoEstacionamento, validarPlaca } from '../veiculos/veiculos.service.js';
import { gerarToken, montarAcessoCliente } from './acesso-cliente.js';
import { COLUNAS_REGRA, regraDoTicket } from '../tarifas/regra.js';
import { escolherTarifa, tarifasDaEntrada } from '../tarifas/selecao.js';
import { pool } from '../../db/pool.js';
import {
  chaveReusada,
  gravarPagamentos,
  MINUTOS_SUSPEITA_DUPLICIDADE,
  pagamentoParecido,
  pagamentosPorChave,
} from '../financeiro/pagamentos.js';
import { configuracoesService } from '../configuracoes/configuracoes.service.js';
import { calculoDaApi, sessoesRepository as repo } from './sessoes.repository.js';

export interface Ator {
  auth: Autenticacao;
  contexto: ContextoAuditoria;
  /** "http://servidor:8080" — base do link do cliente enquanto o PWA não existe. */
  origem: string;
}

const hora = (d: Date | string) =>
  new Date(d).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });

async function carregar(siteId: string, id: string, c?: Conexao, travar = false): Promise<SessaoDetalhe> {
  const s = await repo.buscarPorId(siteId, id, c, travar);
  if (!s) throw erros.naoEncontrado('Ticket não encontrado');
  return s;
}

/** Recusa operar em sessão que não está aberta (saída/cancelamento duplicados). */
function exigirAberta(s: SessaoDetalhe, acao: string) {
  if (s.status === 'ENCERRADA') {
    throw new AppError(
      409,
      'CONFLITO',
      `O ticket nº ${s.numero} (${formatarPlaca(s.placa)}) já foi encerrado em ${hora(s.saidaEm!)}. Não é possível ${acao} de novo.`,
      {
        sessaoId: s.id,
        status: s.status,
      },
    );
  }
  if (s.status === 'CANCELADA') {
    throw new AppError(
      409,
      'CONFLITO',
      `O ticket nº ${s.numero} (${formatarPlaca(s.placa)}) foi cancelado. Não é possível ${acao}.`,
      { sessaoId: s.id, status: s.status },
    );
  }
}

/** Ticket mudou: evento com o estado público atual e as vagas livres (sync com a nuvem). */
async function eventoTicket(c: Conexao, siteId: string, tipo: string, s: SessaoDetalhe) {
  await publicarTicket(c, siteId, tipo, s.id);
  await publicarDisponibilidade(c, siteId);
}

/** Desconto/acréscimo exigem permissão; para gravar, também o motivo. */
function exigirAjustePermitido(
  ator: Ator,
  desconto: number,
  acrescimo: number,
  motivo?: string | null,
  gravar = true,
) {
  if ((desconto || acrescimo) && !ator.auth.temPermissao('sessao.ajustar_valor')) {
    throw new AppError(403, 'SEM_PERMISSAO', 'Você não tem permissão para conceder desconto ou acréscimo.');
  }
  if (gravar && (desconto || acrescimo) && !motivo?.trim()) {
    throw erros.requisicaoInvalida('Informe o motivo do desconto/acréscimo', [
      { campo: 'motivoAjuste', mensagem: 'Obrigatório' },
    ]);
  }
}

/**
 * Gerente e Operador concedem desconto só até o limite definido pelo
 * Administrador (Configurações → Usuários e permissões). Administrador: sem limite.
 */
async function exigirDescontoNoLimite(ator: Ator, desconto: number, calculado: number) {
  if (!desconto) return;
  const nivel = nivelDosPerfis(ator.auth.perfis);
  if (nivel === 'admin') return;
  const { limitesAjuste } = await carregarConfig();
  const limite = limitesAjuste[nivel];
  const pelaPorcentagem = Math.floor((calculado * limite.percentualMax) / 100);
  const maximo =
    limite.valorMaxCentavos > 0 ? Math.min(pelaPorcentagem, limite.valorMaxCentavos) : pelaPorcentagem;
  if (desconto > maximo) {
    throw new AppError(
      403,
      'LIMITE_AJUSTE',
      maximo > 0
        ? `O desconto máximo que você pode conceder neste ticket é ${formatarCentavos(maximo)}. Acima disso, peça a um administrador.`
        : 'Você não pode conceder desconto. Peça a um gerente ou administrador.',
      { maximoCentavos: maximo },
    );
  }
}

/**
 * Valor do ticket aberto AGORA (relógio do banco), pela regra gravada na
 * entrada. Usado pela prévia e pelo encerramento — a mesma conta.
 */
async function calcularAgora(
  c: Conexao | typeof pool,
  s: SessaoDetalhe,
  ajustes: { descontoCentavos: number; acrescimoCentavos: number },
) {
  const [[t]] = await c.query<RowDataPacket[]>(
    `SELECT NOW(3) AS agora, s.tarifa_aplicada, ${COLUNAS_REGRA}
       FROM sessoes_estacionamento s JOIN tarifa_regras r ON r.id = s.tarifa_regra_id WHERE s.id = ?`,
    [s.id],
  );
  const agora = t!.agora as Date;
  const regra = regraDoTicket(t!);
  const estadia = calcularEstadia({
    entradaEm: new Date(s.entradaEm),
    fim: agora,
    regra,
    modalidade: s.modalidade,
    pagoCentavos: s.calculo.pagoCentavos,
    ...ajustes,
    emAndamento: true,
  });
  return { agora, regra, estadia };
}

const formasParaConferencia = (formas: Awaited<ReturnType<typeof repo.formasAtivas>>) =>
  [...formas].map(([codigo, f]) => ({ codigo, ...f }));

export const sessoesService = {
  abertas: async () => repo.abertas((await obterSiteAtual()).id),
  obter: async (id: string) => carregar((await obterSiteAtual()).id, id),

  /** Localiza o ticket pela placa ou pelo número (para a saída). */
  async localizar(termo: string): Promise<SessaoDetalhe> {
    const site = await obterSiteAtual();
    // Número do ticket: só dígitos, com "nº"/"n°"/"no" opcional na frente ("123", "nº 123").
    // Atenção: placas podem começar com N/NO (ex.: NOV1A11), por isso o prefixo só é
    // considerado quando o resto é inteiramente numérico.
    const numero = /^(?:n[ºo°.]?\s*)?(\d{1,12})$/i.exec(termo.trim())?.[1];
    const placa = normalizarPlaca(termo);
    const s = numero
      ? await repo.buscarPorNumero(site.id, Number(numero))
      : await repo.buscarPorPlaca(site.id, placa);
    if (!s) {
      throw erros.naoEncontrado(
        numero
          ? `Nenhum ticket com o número ${numero}.`
          : `Não há nenhum ticket para a placa ${formatarPlaca(placa)}.`,
      );
    }
    return s;
  },

  /** Tarifas da tabela vigente que o operador pode usar na entrada. */
  tarifasDaEntrada: async (categoriaId: string) =>
    tarifasDaEntrada(pool, (await obterSiteAtual()).id, categoriaId),
  vagasLivres: async (categoriaId: string) => repo.vagasLivres((await obterSiteAtual()).id, categoriaId),

  // -------------------------------------------------------------------------
  // ENTRADA
  // -------------------------------------------------------------------------
  async registrarEntrada(ator: Ator, pedido: PedidoEntrada): Promise<ResultadoEntrada> {
    const site = await obterSiteAtual();
    const placa = validarPlaca(pedido.placa, pedido.placaEstrangeira);
    const { token, hash } = gerarToken();

    const transacao = () =>
      comTransacao(ator.contexto, async (c) => {
        // 1. Identifica ou cadastra o veículo
        const [[existente]] = await c.query<RowDataPacket[]>(
          'SELECT id, categoria_id FROM veiculos WHERE site_id = ? AND placa = ? FOR UPDATE',
          [site.id, placa],
        );
        let veiculoId = existente?.id as string | undefined;
        const categoriaId = pedido.categoriaId ?? (existente?.categoria_id as string | undefined);
        if (!categoriaId) {
          throw erros.requisicaoInvalida('Veículo ainda não cadastrado: informe a categoria', [
            { campo: 'categoriaId', mensagem: 'Escolha carro, moto...' },
          ]);
        }
        const [[cat]] = await c.query<RowDataPacket[]>(
          'SELECT nome, ativo FROM categorias_veiculo WHERE id = ? AND site_id = ?',
          [categoriaId, site.id],
        );
        if (!cat || !Number(cat.ativo))
          throw erros.regraDeNegocio('Categoria de veículo inexistente ou desativada.');

        if (!veiculoId) {
          if (!ator.auth.temPermissao('veiculo.gerenciar') && !ator.auth.temPermissao('sessao.entrada')) {
            throw new AppError(403, 'SEM_PERMISSAO', 'Você não pode cadastrar veículos.');
          }
          veiculoId = ulid();
          await c.query(
            'INSERT INTO veiculos (id, site_id, placa, placa_estrangeira, categoria_id, marca, modelo, cor, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              veiculoId,
              site.id,
              placa,
              pedido.placaEstrangeira ?? false,
              categoriaId,
              pedido.marca?.trim() || null,
              pedido.modelo?.trim() || null,
              pedido.cor?.trim() || null,
              ator.auth.id,
            ],
          );
        }

        // 2. Regra: o veículo não pode já estar estacionado
        await exigirVeiculoForaDoEstacionamento(c, veiculoId);

        // 3. Tarifa da tabela vigente: padrão, especial do horário ou a escolhida pelo operador.
        //    A cópia completa da regra fica gravada no ticket (não muda se a tabela mudar).
        const modalidade = pedido.modalidade ?? 'AVULSO';
        const regra = await escolherTarifa(c, {
          siteId: site.id,
          categoriaId,
          categoriaNome: String(cat.nome),
          modalidade,
          regraId: pedido.tarifaRegraId,
        });

        // 4. Vaga: a escolhida (validada) ou a primeira livre da categoria
        let vagaId: string;
        if (pedido.vagaId) {
          const v = await repo.travarVaga(c, site.id, pedido.vagaId);
          if (!v) throw erros.requisicaoInvalida('Vaga não encontrada');
          if (v.situacao === 'MANUTENCAO') throw erros.regraDeNegocio(`A vaga ${v.codigo} está bloqueada.`);
          if (v.situacao === 'INATIVA') throw erros.regraDeNegocio(`A vaga ${v.codigo} foi removida.`);
          if (v.ocupadaPor)
            throw new AppError(
              409,
              'REGISTRO_DUPLICADO',
              `A vaga ${v.codigo} já está ocupada pelo veículo ${formatarPlaca(v.ocupadaPor)}.`,
            );
          if (v.categoriaId !== categoriaId)
            throw erros.regraDeNegocio(
              `A vaga ${v.codigo} é de ${v.categoria}, mas o veículo é ${cat.nome}.`,
            );
          vagaId = v.id;
        } else {
          const v = await repo.travarVagaLivre(c, site.id, categoriaId);
          if (!v)
            throw erros.regraDeNegocio(
              `Não há vagas disponíveis para ${cat.nome}. O estacionamento está lotado nessa categoria.`,
            );
          vagaId = v.id;
        }

        // 5. Cria a sessão (horário do servidor local) e o acesso do cliente
        const id = ulid();
        await c.query(
          `INSERT INTO sessoes_estacionamento (id, site_id, numero, veiculo_id, placa, categoria_id, vaga_id, tarifa_regra_id,
                                             tarifa_aplicada, modalidade, entrada_em, operador_entrada_id, posto_entrada_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, ?)`,
          [
            id,
            site.id,
            await repo.proximoNumero(c, site.id),
            veiculoId,
            placa,
            categoriaId,
            vagaId,
            regra.regraId,
            JSON.stringify(regra.aplicada),
            modalidade,
            ator.auth.id,
            pedido.postoId ?? null,
          ],
        );
        await c.query(
          'INSERT INTO sessao_tokens (id, sessao_id, token_hash, criado_por) VALUES (?, ?, ?, ?)',
          [ulid(), id, hash, ator.auth.id],
        );

        const s = await carregar(site.id, id, c);
        await eventoTicket(c, site.id, 'ticket.aberto', s);
        return { sessaoId: id, veiculoNovo: !existente };
      });

    // Vaga escolhida automaticamente e "roubada" por outra entrada simultânea: a outra
    // transação já gravou, mas a nossa leitura era anterior. Repete com leitura nova —
    // pega outra vaga livre ou responde que lotou (em vez de "vaga ocupada").
    let resultado: Awaited<ReturnType<typeof transacao>> | undefined;
    for (let tentativa = 1; !resultado; tentativa++) {
      try {
        resultado = await transacao();
      } catch (erro) {
        const e = erro as { errno?: number; sqlMessage?: string };
        const vagaDisputada = e.errno === 1062 && e.sqlMessage?.includes('uq_sessoes_vaga_aberta');
        if (!vagaDisputada || pedido.vagaId || tentativa >= 3) throw erro;
      }
    }
    const { sessaoId, veiculoNovo } = resultado;

    const sessao = await carregar(site.id, sessaoId);
    return {
      sessao,
      veiculoCadastradoAgora: veiculoNovo,
      acesso: await montarAcessoCliente(
        token,
        { numero: sessao.numero, placa: sessao.placa, vaga: sessao.vaga, nomeEstacionamento: site.nome },
        ator.origem,
      ),
    };
  },

  // -------------------------------------------------------------------------
  // SAÍDA
  // -------------------------------------------------------------------------
  /**
   * Prévia da saída: valor agora, ajustes, pagamentos conferidos e troco —
   * sem gravar nada. É a mesma conta do encerramento.
   */
  async previaSaida(ator: Ator, id: string, pedido: PedidoPreviaSaida): Promise<PreviaSaida> {
    const site = await obterSiteAtual();
    const desconto = pedido.descontoCentavos ?? 0;
    const acrescimo = pedido.acrescimoCentavos ?? 0;
    exigirAjustePermitido(ator, desconto, acrescimo, null, false);
    const s = await carregar(site.id, id);
    exigirAberta(s, 'registrar a saída');
    const { agora, regra, estadia } = await calcularAgora(pool, s, {
      descontoCentavos: desconto,
      acrescimoCentavos: acrescimo,
    });
    await exigirDescontoNoLimite(ator, desconto, estadia.valorCalculadoCentavos);
    const conferencia = conferirPagamentos(
      estadia.aPagarCentavos,
      pedido.pagamentos,
      formasParaConferencia(await repo.formasAtivas(pool)),
    );
    const problemas: PreviaSaida['problemas'] = conferencia.problemas.map(({ mensagem, linha }) => ({
      mensagem,
      linha,
    }));
    if (estadia.excedentePagoCentavos > 0) {
      problemas.unshift({
        mensagem: `Já foram pagos ${formatarCentavos(estadia.pagoCentavos)}, mais que o valor final (${formatarCentavos(estadia.valorFinalCentavos)}). Estorne a diferença antes de encerrar.`,
      });
    }
    if (conferencia.pagamentos.length && !(await repo.caixaAbertoDoOperador(pool, ator.auth.id))) {
      problemas.push({ mensagem: 'Abra o seu caixa para receber o pagamento.', acao: 'ABRIR_CAIXA' });
    }
    return {
      calculo: calculoDaApi(estadia, agora, regra, s.modalidade),
      descontoCentavos: estadia.descontoCentavos,
      acrescimoCentavos: estadia.acrescimoCentavos,
      valorFinalCentavos: estadia.valorFinalCentavos,
      aPagarCentavos: estadia.aPagarCentavos,
      pagamentos: conferencia.pagamentos.map((p) => ({
        linha: p.linha,
        forma: p.forma,
        formaNome: p.formaNome,
        valorCentavos: p.valorCentavos,
        valorRecebidoCentavos: p.valorRecebidoCentavos,
        trocoCentavos: p.trocoCentavos,
        automatico: p.automatico,
      })),
      somaPagamentosCentavos: conferencia.somaCentavos,
      diferencaCentavos: conferencia.diferencaCentavos,
      trocoTotalCentavos: conferencia.trocoTotalCentavos,
      problemas,
    };
  },

  /**
   * Recebe um pagamento com o veículo ainda no estacionamento (antecipado ou
   * parcial). Fica associado ao ticket e abate do valor da saída.
   */
  async receber(ator: Ator, id: string, pedido: PedidoPagamento): Promise<ResultadoPagamento> {
    const site = await obterSiteAtual();
    let pagamentoId = '';
    let troco = 0;
    let repetido: boolean = false;
    await comTransacao({ ...ator.contexto, motivo: 'pagamento antecipado' }, async (c) => {
      const s = await carregar(site.id, id, c, true);

      // Reenvio da mesma operação: devolve o pagamento já registrado
      const ja = (await pagamentosPorChave(c, [pedido.chaveIdempotencia])).get(pedido.chaveIdempotencia);
      if (ja) {
        const mesmo =
          ja.sessaoId === id &&
          ja.forma === pedido.forma &&
          (pedido.valorCentavos === null || ja.valorCentavos === pedido.valorCentavos);
        if (!mesmo) throw chaveReusada();
        pagamentoId = ja.id;
        troco = ja.trocoCentavos;
        repetido = true;
        return;
      }

      exigirAberta(s, 'receber um pagamento');
      const caixa = await repo.caixaAbertoDoOperador(c, ator.auth.id);
      if (!caixa) {
        throw new AppError(422, 'REGRA_DE_NEGOCIO', 'Abra o seu caixa para receber o pagamento.', {
          acao: 'ABRIR_CAIXA',
        });
      }
      const { estadia } = await calcularAgora(c, s, { descontoCentavos: 0, acrescimoCentavos: 0 });
      if (estadia.aPagarCentavos === 0) {
        throw erros.regraDeNegocio(
          estadia.valorCalculadoCentavos === 0
            ? 'Este ticket ainda está dentro da tolerância: não há valor a receber.'
            : 'Este ticket não tem valor em aberto: o que foi acumulado até agora já está pago.',
        );
      }
      const valor = pedido.valorCentavos ?? estadia.aPagarCentavos;
      if (valor > estadia.aPagarCentavos) {
        throw erros.regraDeNegocio(
          `O pagamento (${formatarCentavos(valor)}) é maior que o valor em aberto agora (${formatarCentavos(estadia.aPagarCentavos)}). Receba no máximo o valor em aberto.`,
          { aPagarCentavos: estadia.aPagarCentavos },
        );
      }
      const conferencia = conferirPagamentos(
        valor,
        [{ ...pedido, valorCentavos: valor }],
        formasParaConferencia(await repo.formasAtivas(c)),
      );
      const problema = conferencia.problemas[0];
      if (problema) {
        throw problema.tipo === 'DADOS'
          ? erros.requisicaoInvalida(problema.mensagem)
          : erros.regraDeNegocio(problema.mensagem);
      }
      const conferido = conferencia.pagamentos[0]!;

      // Mesmo valor e forma neste ticket há poucos minutos: provável lançamento em dobro
      if (!pedido.confirmarDuplicidade) {
        const parecido = await pagamentoParecido(c, id, conferido.forma, conferido.valorCentavos);
        if (parecido) {
          throw new AppError(
            409,
            'CONFLITO',
            `Já existe um pagamento de ${formatarCentavos(conferido.valorCentavos)} em ${conferido.formaNome} neste ticket, registrado há menos de ${MINUTOS_SUSPEITA_DUPLICIDADE} minutos. Se for mesmo outro pagamento, confirme.`,
            {
              motivo: 'POSSIVEL_DUPLICIDADE',
              pagamentoId: parecido.id,
              registradoEm: parecido.registradoEm.toISOString(),
            },
          );
        }
      }

      [pagamentoId] = (await gravarPagamentos(c, {
        siteId: site.id,
        sessaoId: id,
        caixaId: caixa.id,
        operadorId: ator.auth.id,
        pagamentos: [
          {
            ...conferido,
            autorizacao: pedido.autorizacao?.trim() || null,
            chaveIdempotencia: pedido.chaveIdempotencia,
          },
        ],
      })) as [string];
      troco = conferido.trocoCentavos;
      await eventoTicket(c, site.id, 'ticket.pagamento', await carregar(site.id, id, c));
    });
    const sessao = await carregar(site.id, id);
    return {
      pagamento: sessao.pagamentos.find((p) => p.id === pagamentoId)!,
      trocoCentavos: troco,
      sessao,
      repetido,
    };
  },

  /**
   * Estorna um pagamento de ticket ainda aberto (lançado errado, cobrado em
   * dobro). O valor sai do caixa aberto de quem estorna.
   */
  async estornarPagamento(ator: Ator, pagamentoId: string, motivo: string): Promise<SessaoDetalhe> {
    const site = await obterSiteAtual();
    const sessaoId = await comTransacao({ ...ator.contexto, motivo }, async (c) => {
      const [[p]] = await c.query<RowDataPacket[]>(
        'SELECT id, sessao_id, forma_codigo, valor_centavos, status FROM pagamentos WHERE id = ? AND site_id = ?',
        [pagamentoId, site.id],
      );
      if (!p) throw erros.naoEncontrado('Pagamento não encontrado');
      // Trava o ticket antes do pagamento (mesma ordem da saída: evita deadlock)
      const s = await carregar(site.id, String(p.sessao_id), c, true);
      const [[atual]] = await c.query<RowDataPacket[]>(
        'SELECT status FROM pagamentos WHERE id = ? FOR UPDATE',
        [pagamentoId],
      );
      if (atual?.status === 'ESTORNADO') throw erros.conflito('Este pagamento já foi estornado.');
      if (s.status !== 'ABERTA') {
        throw erros.regraDeNegocio(
          `O ticket nº ${s.numero} já foi ${s.status === 'ENCERRADA' ? 'encerrado' : 'cancelado'}: a conta está fechada e o pagamento não pode ser estornado.`,
        );
      }
      const caixa = await repo.caixaAbertoDoOperador(c, ator.auth.id);
      if (!caixa) {
        throw new AppError(422, 'REGRA_DE_NEGOCIO', 'Abra o seu caixa para fazer o estorno.', {
          acao: 'ABRIR_CAIXA',
        });
      }
      const valor = Number(p.valor_centavos);
      if (p.forma_codigo === 'DINHEIRO') {
        const [[d]] = await c.query<RowDataPacket[]>(
          "SELECT COALESCE(SUM(saldo_centavos), 0) AS saldo FROM vw_caixa_resumo WHERE caixa_sessao_id = ? AND forma_codigo = 'DINHEIRO'",
          [caixa.id],
        );
        if (Number(d?.saldo) < valor) {
          throw erros.regraDeNegocio(
            `Não há dinheiro suficiente no seu caixa para devolver ${formatarCentavos(valor)} (há ${formatarCentavos(Number(d?.saldo))}).`,
          );
        }
      }
      await c.query(
        "UPDATE pagamentos SET status = 'ESTORNADO', estornado_em = NOW(3), estornado_por = ?, motivo_estorno = ? WHERE id = ? AND status = 'CONFIRMADO'",
        [ator.auth.id, motivo, pagamentoId],
      );
      await c.query(
        `INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo,
                                                pagamento_id, sessao_id, descricao, registrado_por, registrado_em)
         VALUES (?, ?, ?, 'ESTORNO', 'SAIDA', ?, ?, ?, ?, ?, ?, NOW(3))`,
        [ulid(), site.id, caixa.id, valor, p.forma_codigo, pagamentoId, s.id, motivo, ator.auth.id],
      );
      await eventoTicket(c, site.id, 'ticket.pagamento_estornado', s);
      return s.id;
    });
    return carregar(site.id, sessaoId);
  },

  async registrarSaida(ator: Ator, id: string, pedido: PedidoSaida): Promise<ReciboSaida> {
    const site = await obterSiteAtual();
    const desconto = pedido.descontoCentavos ?? 0;
    const acrescimo = pedido.acrescimoCentavos ?? 0;
    exigirAjustePermitido(ator, desconto, acrescimo, pedido.motivoAjuste);

    let troco = 0;
    let repetido: boolean = false;
    await comTransacao(
      { ...ator.contexto, motivo: pedido.motivoAjuste ?? ator.contexto.motivo },
      async (c) => {
        // Trava o ticket: duas saídas simultâneas do mesmo ticket ficam em fila e a segunda vê "já encerrado"
        const s = await carregar(site.id, id, c, true);

        // Reenvio da MESMA saída (duplo clique, rede caiu antes da resposta): devolve o recibo, não grava de novo
        const chaves = pedido.pagamentos.map((p) => p.chaveIdempotencia);
        const jaGravados = await pagamentosPorChave(c, chaves);
        if (jaGravados.size) {
          const todosDesta = chaves.every((k) => jaGravados.get(k)?.sessaoId === id);
          if (!todosDesta || s.status !== 'ENCERRADA') throw chaveReusada();
          repetido = true;
          troco = [...jaGravados.values()].reduce((t, p) => t + p.trocoCentavos, 0);
          return;
        }
        exigirAberta(s, 'registrar a saída');

        // Cobra pela regra gravada no ticket na entrada, nunca pela tabela atual
        const { agora, estadia } = await calcularAgora(c, s, {
          descontoCentavos: desconto,
          acrescimoCentavos: acrescimo,
        });
        const calculado = estadia.valorCalculadoCentavos;
        const final = estadia.valorFinalCentavos;
        await exigirDescontoNoLimite(ator, desconto, calculado);

        // O valor mudou desde que o operador conferiu (ex.: virou a fração)?
        if (calculado !== pedido.valorEsperadoCentavos) {
          throw new AppError(
            409,
            'CONFLITO',
            `O valor da estadia mudou de ${formatarCentavos(pedido.valorEsperadoCentavos)} para ${formatarCentavos(calculado)}. Confira e confirme novamente.`,
            { valorCalculadoCentavos: calculado },
          );
        }
        if (estadia.excedentePagoCentavos > 0) {
          throw erros.regraDeNegocio(
            `Já foram pagos ${formatarCentavos(s.calculo.pagoCentavos)}, mais que o valor final (${formatarCentavos(final)}). Estorne a diferença antes de encerrar.`,
          );
        }

        // Mesma conferência da prévia: soma, troco, linha automática
        const formas = await repo.formasAtivas(c);
        const conferencia = conferirPagamentos(
          estadia.aPagarCentavos,
          pedido.pagamentos,
          formasParaConferencia(formas),
        );
        const problema = conferencia.problemas[0];
        if (problema) {
          throw problema.tipo === 'DADOS'
            ? erros.requisicaoInvalida(problema.mensagem)
            : erros.regraDeNegocio(problema.mensagem, { aPagarCentavos: estadia.aPagarCentavos });
        }

        // Registros financeiros: pagamento(s) + movimentação no caixa do operador
        if (conferencia.pagamentos.length) {
          if (!ator.auth.temPermissao('pagamento.registrar'))
            throw new AppError(403, 'SEM_PERMISSAO', 'Você não tem permissão para registrar pagamentos.');
          const caixa = await repo.caixaAbertoDoOperador(c, ator.auth.id);
          if (!caixa)
            throw new AppError(422, 'REGRA_DE_NEGOCIO', 'Abra o seu caixa para receber o pagamento.', {
              acao: 'ABRIR_CAIXA',
            });
          troco = conferencia.trocoTotalCentavos;
          await gravarPagamentos(c, {
            siteId: site.id,
            sessaoId: id,
            caixaId: caixa.id,
            operadorId: ator.auth.id,
            pagamentos: conferencia.pagamentos.map((p) => ({
              ...p,
              autorizacao: pedido.pagamentos[p.linha]!.autorizacao?.trim() || null,
              chaveIdempotencia: pedido.pagamentos[p.linha]!.chaveIdempotencia,
            })),
          });
        }

        // Encerra (a condição "status = ABERTA" garante que nunca encerra duas vezes)
        const [r] = await c.query<ResultSetHeader>(
          `UPDATE sessoes_estacionamento
            SET status = 'ENCERRADA', saida_em = ?, operador_saida_id = ?, posto_saida_id = ?,
                valor_calculado_centavos = ?, desconto_centavos = ?, acrescimo_centavos = ?, valor_final_centavos = ?, motivo_ajuste = ?,
                calculo_detalhe = ?
          WHERE id = ? AND status = 'ABERTA'`,
          [
            agora,
            ator.auth.id,
            pedido.postoId ?? null,
            calculado,
            desconto,
            acrescimo,
            final,
            pedido.motivoAjuste?.trim() || null,
            JSON.stringify({
              calculadoEm: agora.toISOString(),
              permanenciaMin: estadia.permanenciaMin,
              modalidade: s.modalidade,
              tarifa: s.tarifaAplicada,
              itens: estadia.itens,
              valorCalculadoCentavos: calculado,
              descontoCentavos: desconto,
              acrescimoCentavos: acrescimo,
              valorFinalCentavos: final,
              pagoAntesCentavos: s.calculo.pagoCentavos,
            }),
            id,
          ],
        );
        if (r.affectedRows !== 1)
          throw new AppError(409, 'CONFLITO', 'Este ticket já foi encerrado por outro operador.');

        // Link do cliente: segue a política de encerramento (Configurações → Link do cliente)
        const politica = await configuracoesService.politicaAcessoCliente(site.id, c);
        await c.query(
          'UPDATE sessao_tokens SET expira_em = ? + INTERVAL ? HOUR WHERE sessao_id = ? AND revogado_em IS NULL',
          [agora, politica.horasAposSaida, id],
        );

        const fechada = await carregar(site.id, id, c);
        await eventoTicket(c, site.id, 'ticket.fechado', fechada);
      },
    );

    return {
      sessao: await carregar(site.id, id),
      trocoTotalCentavos: troco,
      ...(repetido ? { repetido: true } : {}),
    };
  },

  /** Cancela uma entrada registrada por engano (sem pagamentos). */
  async cancelar(ator: Ator, id: string, motivo: string): Promise<SessaoDetalhe> {
    const site = await obterSiteAtual();
    await comTransacao({ ...ator.contexto, motivo }, async (c) => {
      const s = await carregar(site.id, id, c, true);
      exigirAberta(s, 'cancelar');
      if (s.calculo.pagoCentavos > 0)
        throw erros.regraDeNegocio('Este ticket tem pagamentos. Estorne-os antes de cancelar.');
      await c.query(
        "UPDATE sessoes_estacionamento SET status = 'CANCELADA', cancelado_em = NOW(3), cancelado_por = ?, motivo_cancelamento = ? WHERE id = ? AND status = 'ABERTA'",
        [ator.auth.id, motivo, id],
      );
      await c.query(
        'UPDATE sessao_tokens SET revogado_em = NOW(3), revogado_por = ?, motivo_revogacao = ? WHERE sessao_id = ? AND revogado_em IS NULL',
        [ator.auth.id, 'ticket cancelado', id],
      );
      await eventoTicket(c, site.id, 'ticket.cancelado', await carregar(site.id, id, c));
    });
    return carregar(site.id, id);
  },

  /** Revoga o link/QR atual e gera outro (cliente perdeu ou compartilhou o link). */
  async novoAcesso(ator: Ator, id: string) {
    const site = await obterSiteAtual();
    const { token, hash } = gerarToken();
    const s = await comTransacao({ ...ator.contexto, motivo: 'novo QR/link do cliente' }, async (c) => {
      const atual = await carregar(site.id, id, c, true);
      exigirAberta(atual, 'gerar um novo link');
      await c.query(
        'UPDATE sessao_tokens SET revogado_em = NOW(3), revogado_por = ?, motivo_revogacao = ? WHERE sessao_id = ? AND revogado_em IS NULL',
        [ator.auth.id, 'novo link gerado pelo operador', id],
      );
      await c.query('INSERT INTO sessao_tokens (id, sessao_id, token_hash, criado_por) VALUES (?, ?, ?, ?)', [
        ulid(),
        id,
        hash,
        ator.auth.id,
      ]);
      await publicarTicket(c, site.id, 'ticket.token_revogado', id);
      return atual;
    });
    return montarAcessoCliente(
      token,
      { numero: s.numero, placa: s.placa, vaga: s.vaga, nomeEstacionamento: site.nome },
      ator.origem,
    );
  },
};
