import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import { detalharTarifa, problemasDaRegra } from '@estacionamento/calculo';
import {
  regraDeDados,
  type DadosRegra,
  type PainelTarifas,
  type PedidoSimulacao,
  type RegraTarifa,
  type ResultadoSimulacao,
  type TabelaTarifaDetalhe,
} from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import type { Conexao } from '../../db/pool.js';
import { pool } from '../../db/pool.js';
import { regraDaLinha } from './regra.js';
import { comTransacao, type ContextoAuditoria } from '../../db/transacao.js';
import { erros } from '../../http/erros.js';
import { publicarTabelaTarifa, registrarEvento } from '../../sync/outbox.js';
import { tarifasRepository as repo } from './tarifas.repository.js';

export interface Ator {
  usuarioId: string;
  contexto: ContextoAuditoria;
}

async function rascunhoTravado(c: Conexao, siteId: string, id: string): Promise<TabelaTarifaDetalhe> {
  const t = await repo.obter(siteId, id, c, true);
  if (!t) throw erros.naoEncontrado('Tabela de tarifas não encontrada');
  if (t.status !== 'RASCUNHO') {
    throw erros.regraDeNegocio(
      `A versão ${t.versao} já foi publicada e não pode ser alterada: isso mudaria a cobrança de quem entrou com ela. Crie uma nova versão.`,
    );
  }
  return t;
}

/** Validações de negócio de uma regra (o banco repete as essenciais em CHECKs). */
function validarRegra(d: DadosRegra) {
  const problemas = problemasDaRegra(regraDeDados(d));
  if (d.tipo === 'ESPECIAL') {
    if (!d.nome?.trim()) problemas.push('Dê um nome à tarifa especial (ex.: "Fim de semana").');
    if (!d.aplicacao) problemas.push('Informe se a tarifa especial é automática ou escolhida pelo operador.');
    if (d.aplicacao === 'AUTOMATICA' && d.diasSemana === null && !d.horaInicio) {
      problemas.push('Uma tarifa especial automática precisa de dias da semana ou de um horário de entrada.');
    }
    if ((d.horaInicio === null) !== (d.horaFim === null))
      problemas.push('Informe o início e o fim do horário.');
    if (d.horaInicio && d.horaInicio === d.horaFim)
      problemas.push('O horário de início e de fim não podem ser iguais.');
    if (d.diasSemana === 0) problemas.push('Escolha ao menos um dia da semana.');
  } else if (d.valorFixoCentavos !== null) {
    problemas.push('Preço fixo só existe em tarifa especial.');
  }
  if (problemas.length) {
    throw erros.requisicaoInvalida(
      problemas[0]!,
      problemas.map((mensagem) => ({ campo: 'regra', mensagem })),
    );
  }
}

const colunas = (d: DadosRegra) => {
  const especial = d.tipo === 'ESPECIAL';
  return {
    categoria_id: d.categoriaId,
    tipo: d.tipo,
    nome: especial ? d.nome!.trim() : null,
    aplicacao: especial ? d.aplicacao : null,
    dias_semana: especial && d.aplicacao === 'AUTOMATICA' ? d.diasSemana : null,
    hora_inicio: especial && d.aplicacao === 'AUTOMATICA' ? d.horaInicio : null,
    hora_fim: especial && d.aplicacao === 'AUTOMATICA' ? d.horaFim : null,
    ativo: d.ativo,
    tolerancia_min: d.toleranciaMin,
    primeira_hora_centavos: d.primeiraHoraCentavos,
    hora_adicional_centavos: d.horaAdicionalCentavos,
    fracao_min: d.fracaoMin,
    fracao_centavos: d.fracaoCentavos,
    carencia_min: d.carenciaMin,
    diaria_maxima_centavos: d.diariaMaximaCentavos,
    diaria_centavos: d.diariaCentavos,
    valor_fixo_centavos: especial ? d.valorFixoCentavos : null,
  };
};

export const tarifasService = {
  /** Simulação de preço: mesma função do caixa, para a tela conferir antes de publicar. */
  async simular(p: PedidoSimulacao): Promise<ResultadoSimulacao> {
    let regras: { id: string | null; regra: RegraTarifa }[];
    if (p.regra) {
      const regra = { ...p.regra, valorFixoCentavos: p.regra.valorFixoCentavos ?? null };
      const problemas = problemasDaRegra(regra);
      if (problemas.length) return { problemas, resultados: [] };
      regras = [{ id: null, regra }];
    } else {
      const site = await obterSiteAtual();
      const [linhas] = await pool.query<RowDataPacket[]>(
        `SELECT r.* FROM tarifa_regras r JOIN tabelas_tarifa t ON t.id = r.tabela_id
          WHERE t.site_id = ? AND r.id IN (?)`,
        [site.id, p.regraIds],
      );
      const porId = new Map(linhas.map((l) => [String(l.id), regraDaLinha(l)]));
      regras = (p.regraIds ?? []).filter((id) => porId.has(id)).map((id) => ({ id, regra: porId.get(id)! }));
    }
    return {
      problemas: [],
      resultados: regras.flatMap(({ id, regra }) =>
        p.duracoes.map((minutos) => {
          if (p.modalidade === 'DIARIA' && regra.diariaCentavos === null)
            return { regraId: id, permanenciaMin: minutos, totalCentavos: null, itens: [] };
          const d = detalharTarifa(regra, minutos, p.modalidade);
          return { regraId: id, permanenciaMin: minutos, totalCentavos: d.totalCentavos, itens: d.itens };
        }),
      ),
    };
  },

  async painel(): Promise<PainelTarifas> {
    const site = await obterSiteAtual();
    const todas = await repo.listar(site.id);
    const vigente = todas.find((t) => t.situacao === 'VIGENTE');
    const rascunho = todas.find((t) => t.situacao === 'RASCUNHO');
    return {
      vigente: vigente ? await repo.obter(site.id, vigente.id) : null,
      rascunho: rascunho ? await repo.obter(site.id, rascunho.id) : null,
      agendadas: todas.filter((t) => t.situacao === 'AGENDADA'),
      historico: todas.filter((t) => t.situacao !== 'RASCUNHO'),
    };
  },

  async obter(id: string) {
    const site = await obterSiteAtual();
    const t = await repo.obter(site.id, id);
    if (!t) throw erros.naoEncontrado('Tabela de tarifas não encontrada');
    return t;
  },

  /**
   * Nova versão em rascunho, copiando as regras de uma versão existente
   * (por padrão, a vigente). Só existe um rascunho por vez.
   */
  async criarRascunho(ator: Ator, o: { baseId?: string | null; nome?: string | null }) {
    const site = await obterSiteAtual();
    const id = await comTransacao(ator.contexto, async (c) => {
      // Trava o site: dois administradores não criam dois rascunhos ao mesmo tempo
      await c.query('SELECT id FROM sites WHERE id = ? FOR UPDATE', [site.id]);
      if (await repo.rascunho(c, site.id)) {
        throw erros.conflito(
          'Já existe uma versão em edição. Continue nela ou descarte-a antes de criar outra.',
        );
      }
      const baseId = o.baseId ?? (await repo.idVigente(c, site.id));
      const base = baseId ? await repo.obter(site.id, baseId, c) : null;
      if (o.baseId && !base) throw erros.naoEncontrado('Versão de origem não encontrada');
      const [[v]] = await c.query<RowDataPacket[]>(
        'SELECT COALESCE(MAX(versao), 0) + 1 AS v FROM tabelas_tarifa WHERE site_id = ?',
        [site.id],
      );
      const versao = Number(v?.v);
      const novo = ulid();
      await c.query(
        'INSERT INTO tabelas_tarifa (id, site_id, versao, nome, descricao, criado_por) VALUES (?, ?, ?, ?, ?, ?)',
        [
          novo,
          site.id,
          versao,
          o.nome?.trim() || `Tabela de tarifas v${versao}`,
          base ? `Baseada na versão ${base.versao}` : null,
          ator.usuarioId,
        ],
      );
      for (const r of base?.regras ?? []) {
        const cols = { id: ulid(), tabela_id: novo, ordem: r.ordem, ...colunas(r) };
        await c.query(
          `INSERT INTO tarifa_regras (${Object.keys(cols).join(', ')}) VALUES (${Object.keys(cols)
            .map(() => '?')
            .join(', ')})`,
          Object.values(cols),
        );
      }
      return novo;
    });
    return this.obter(id);
  },

  async editarRascunho(ator: Ator, id: string, d: { nome: string; descricao: string | null }) {
    const site = await obterSiteAtual();
    await comTransacao(ator.contexto, async (c) => {
      await rascunhoTravado(c, site.id, id);
      await c.query('UPDATE tabelas_tarifa SET nome = ?, descricao = ? WHERE id = ?', [
        d.nome.trim(),
        d.descricao?.trim() || null,
        id,
      ]);
    });
    return this.obter(id);
  },

  /** Cadastra (regraId null) ou edita uma regra do rascunho. */
  async salvarRegra(ator: Ator, tabelaId: string, regraId: string | null, d: DadosRegra) {
    validarRegra(d);
    const site = await obterSiteAtual();
    await comTransacao(ator.contexto, async (c) => {
      const t = await rascunhoTravado(c, site.id, tabelaId);
      const [[cat]] = await c.query<RowDataPacket[]>(
        'SELECT nome, ativo FROM categorias_veiculo WHERE id = ? AND site_id = ?',
        [d.categoriaId, site.id],
      );
      if (!cat)
        throw erros.requisicaoInvalida('Categoria inexistente', [
          { campo: 'categoriaId', mensagem: 'Inexistente' },
        ]);
      const cols = colunas(d);
      if (regraId) {
        if (!t.regras.some((r) => r.id === regraId))
          throw erros.naoEncontrado('Regra não encontrada nesta versão');
        const [res] = await c.query<ResultSetHeader>(
          `UPDATE tarifa_regras SET ${Object.keys(cols)
            .map((k) => `${k} = ?`)
            .join(', ')} WHERE id = ? AND tabela_id = ?`,
          [...Object.values(cols), regraId, tabelaId],
        );
        if (res.affectedRows !== 1) throw erros.naoEncontrado('Regra não encontrada nesta versão');
      } else {
        const ordem = t.regras.filter((r) => r.categoriaId === d.categoriaId).length;
        const todas = { id: ulid(), tabela_id: tabelaId, ordem, ...cols };
        await c.query(
          `INSERT INTO tarifa_regras (${Object.keys(todas).join(', ')}) VALUES (${Object.keys(todas)
            .map(() => '?')
            .join(', ')})`,
          Object.values(todas),
        );
      }
    });
    return this.obter(tabelaId);
  },

  async removerRegra(ator: Ator, tabelaId: string, regraId: string) {
    const site = await obterSiteAtual();
    await comTransacao(ator.contexto, async (c) => {
      await rascunhoTravado(c, site.id, tabelaId);
      const [res] = await c.query<ResultSetHeader>(
        'DELETE FROM tarifa_regras WHERE id = ? AND tabela_id = ?',
        [regraId, tabelaId],
      );
      if (res.affectedRows !== 1) throw erros.naoEncontrado('Regra não encontrada nesta versão');
    });
    return this.obter(tabelaId);
  },

  async descartarRascunho(ator: Ator, id: string) {
    const site = await obterSiteAtual();
    await comTransacao(ator.contexto, async (c) => {
      const t = await rascunhoTravado(c, site.id, id);
      await c.query('DELETE FROM tarifa_regras WHERE tabela_id = ?', [id]);
      await c.query('DELETE FROM tabelas_tarifa WHERE id = ?', [id]);
      return t;
    });
  },

  /**
   * Publica o rascunho: passa a valer agora ou na data agendada. Tickets já
   * abertos continuam com a tarifa gravada na entrada.
   */
  async publicar(ator: Ator, id: string, vigenteDesde: Date | null) {
    const site = await obterSiteAtual();
    await comTransacao(ator.contexto, async (c) => {
      await rascunhoTravado(c, site.id, id);
      const [[agora]] = await c.query<RowDataPacket[]>('SELECT NOW(3) AS n');
      const inicio = vigenteDesde ?? (agora?.n as Date);
      if (vigenteDesde && vigenteDesde.getTime() < (agora?.n as Date).getTime()) {
        throw erros.regraDeNegocio(
          'A data de início não pode estar no passado. Use "Publicar agora" ou uma data futura.',
        );
      }

      // Toda categoria em uso (com vagas ativas) precisa de preço padrão ativo
      const [semPreco] = await c.query<RowDataPacket[]>(
        `SELECT c.nome FROM categorias_veiculo c
          WHERE c.site_id = ? AND c.ativo
            AND EXISTS (SELECT 1 FROM vagas v WHERE v.categoria_id = c.id AND v.situacao <> 'INATIVA')
            AND NOT EXISTS (SELECT 1 FROM tarifa_regras r WHERE r.tabela_id = ? AND r.categoria_id = c.id
                              AND r.tipo = 'PADRAO' AND r.ativo)
          ORDER BY c.ordem, c.nome`,
        [site.id, id],
      );
      if (semPreco.length) {
        const nomes = semPreco.map((l) => l.nome).join(', ');
        throw erros.regraDeNegocio(
          `Defina a tarifa padrão de ${nomes}: há vagas para essa categoria e sem preço nenhuma entrada poderia ser registrada.`,
          { categorias: semPreco.map((l) => l.nome) },
        );
      }

      await c.query(
        "UPDATE tabelas_tarifa SET status = 'PUBLICADA', vigente_desde = ?, publicado_em = NOW(3), publicado_por = ? WHERE id = ? AND status = 'RASCUNHO'",
        [inicio, ator.usuarioId, id],
      );
      // A nuvem e o app do cliente recebem a tabela (preços exibidos ao cliente)
      await publicarTabelaTarifa(c, site.id, id);
    });
    return this.obter(id);
  },

  /** Arquiva uma versão publicada que não está valendo (ex.: cancelar um agendamento). */
  async arquivar(ator: Ator, id: string) {
    const site = await obterSiteAtual();
    await comTransacao(ator.contexto, async (c) => {
      const t = await repo.obter(site.id, id, c, true);
      if (!t) throw erros.naoEncontrado('Tabela de tarifas não encontrada');
      if (t.status === 'RASCUNHO') throw erros.regraDeNegocio('Rascunho não é arquivado: descarte-o.');
      if (t.status === 'ARQUIVADA') throw erros.conflito(`A versão ${t.versao} já está arquivada.`);
      if (t.situacao === 'VIGENTE') {
        throw erros.regraDeNegocio(
          `A versão ${t.versao} é a que está valendo agora. Para mudar os preços, publique uma nova versão.`,
        );
      }
      await c.query("UPDATE tabelas_tarifa SET status = 'ARQUIVADA', arquivado_em = NOW(3) WHERE id = ?", [
        id,
      ]);
      await registrarEvento(c, {
        siteId: site.id,
        tipo: 'tarifa.arquivada',
        agregadoTipo: 'tabela_tarifa',
        agregadoId: id,
        payload: { tipo: 'tabela_tarifa_arquivada', tabelaId: id },
      });
    });
    return this.obter(id);
  },
};
