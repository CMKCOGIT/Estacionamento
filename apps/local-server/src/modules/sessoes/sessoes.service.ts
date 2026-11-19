import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import { calcularEstadia, conferirPagamentos } from '@estacionamento/calculo';
import {
  formatarCentavos,
  formatarPlaca,
  normalizarPlaca,
  type PedidoEntrada,
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
import type { Autenticacao } from '../auth/auth.service.js';
import { publicarDisponibilidade, registrarEvento } from '../../sync/outbox.js';
import { exigirVeiculoForaDoEstacionamento, validarPlaca } from '../veiculos/veiculos.service.js';
import { gerarToken, montarAcessoCliente } from './acesso-cliente.js';
import { COLUNAS_REGRA, regraDoTicket } from '../tarifas/regra.js';
import { escolherTarifa, tarifasDaEntrada } from '../tarifas/selecao.js';
import { pool } from '../../db/pool.js';
import { calculoDaApi, sessoesRepository as repo } from './sessoes.repository.js';

export interface Ator {
  auth: Autenticacao;
  contexto: ContextoAuditoria;
  /** "http://servidor:8080" — base do link do cliente enquanto o PWA não existe. */
  origem: string;
}

/** Validade do link do cliente depois da saída (docs/ARQUITETURA.md §9). */
const HORAS_LINK_APOS_SAIDA = 24;

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

async function eventoTicket(
  c: Conexao,
  siteId: string,
  tipo: string,
  s: SessaoDetalhe,
  extra: Record<string, unknown> = {},
) {
  await registrarEvento(c, {
    siteId,
    tipo,
    agregadoTipo: 'ticket',
    agregadoId: s.id,
    payload: {
      ticket_id: s.id,
      numero: s.numero,
      placa: s.placa,
      categoria: s.categoria,
      vaga: s.vaga,
      entrada_em: s.entradaEm,
      modalidade: s.modalidade,
      ...extra,
    },
  });
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
        await eventoTicket(c, site.id, 'ticket.aberto', s, {
          token_hash: hash.toString('hex'),
          tarifa_regra_id: regra.regraId,
        });
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

  async registrarSaida(ator: Ator, id: string, pedido: PedidoSaida): Promise<ReciboSaida> {
    const site = await obterSiteAtual();
    const desconto = pedido.descontoCentavos ?? 0;
    const acrescimo = pedido.acrescimoCentavos ?? 0;
    exigirAjustePermitido(ator, desconto, acrescimo, pedido.motivoAjuste);

    let troco = 0;
    await comTransacao(
      { ...ator.contexto, motivo: pedido.motivoAjuste ?? ator.contexto.motivo },
      async (c) => {
        // Trava o ticket: duas saídas simultâneas do mesmo ticket ficam em fila e a segunda vê "já encerrado"
        const s = await carregar(site.id, id, c, true);
        exigirAberta(s, 'registrar a saída');

        // Cobra pela regra gravada no ticket na entrada, nunca pela tabela atual
        const { agora, estadia } = await calcularAgora(c, s, {
          descontoCentavos: desconto,
          acrescimoCentavos: acrescimo,
        });
        const calculado = estadia.valorCalculadoCentavos;
        const final = estadia.valorFinalCentavos;

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
          for (const p of conferencia.pagamentos) {
            const informado = pedido.pagamentos[p.linha]!;
            const pagamentoId = ulid();
            troco += p.trocoCentavos;
            await c.query(
              `INSERT INTO pagamentos (id, site_id, sessao_id, caixa_sessao_id, forma_codigo, valor_centavos, valor_recebido_centavos,
                                     troco_centavos, autorizacao, parcelas, chave_idempotencia, registrado_por, registrado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
              [
                pagamentoId,
                site.id,
                id,
                caixa.id,
                p.forma,
                p.valorCentavos,
                p.valorRecebidoCentavos,
                p.trocoCentavos,
                informado.autorizacao?.trim() || null,
                p.parcelas,
                informado.chaveIdempotencia,
                ator.auth.id,
              ],
            );
            await c.query(
              `INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, pagamento_id, sessao_id, registrado_por, registrado_em)
             VALUES (?, ?, ?, 'RECEBIMENTO', 'ENTRADA', ?, ?, ?, ?, ?, NOW(3))`,
              [ulid(), site.id, caixa.id, p.valorCentavos, p.forma, pagamentoId, id, ator.auth.id],
            );
          }
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

        // Link do cliente continua valendo por 24h após a saída
        await c.query(
          'UPDATE sessao_tokens SET expira_em = ? + INTERVAL ? HOUR WHERE sessao_id = ? AND revogado_em IS NULL',
          [agora, HORAS_LINK_APOS_SAIDA, id],
        );

        const fechada = await carregar(site.id, id, c);
        await eventoTicket(c, site.id, 'ticket.fechado', fechada, {
          saida_em: fechada.saidaEm,
          valor_final_centavos: final,
          status: 'pago',
        });
      },
    );

    return { sessao: await carregar(site.id, id), trocoTotalCentavos: troco };
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
      await eventoTicket(c, site.id, 'ticket.cancelado', await carregar(site.id, id, c), { motivo });
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
      await registrarEvento(c, {
        siteId: site.id,
        tipo: 'ticket.token_revogado',
        agregadoTipo: 'ticket',
        agregadoId: id,
        payload: { ticket_id: id, token_hash: hash.toString('hex') },
      });
      return atual;
    });
    return montarAcessoCliente(
      token,
      { numero: s.numero, placa: s.placa, vaga: s.vaga, nomeEstacionamento: site.nome },
      ator.origem,
    );
  },
};
