import type { RowDataPacket } from 'mysql2/promise';
import type {
  Agrupamento,
  CaixaResumo,
  EventoHistorico,
  Movimentacao,
  PagamentoRegistro,
} from '@estacionamento/shared';
import { pool } from '../../db/pool.js';
import {
  FUSO,
  montarCaixas,
  nome,
  noPeriodo,
  paraMovimentacao,
  paraPagamento,
  SELECT_CAIXA,
  SELECT_MOV,
} from '../financeiro/financeiro.repository.js';

const n = (v: unknown) => Number(v ?? 0);

/** Dia local (AAAA-MM-DD) de uma coluna gravada em UTC. */
const diaLocal = (coluna: string) => `DATE(CONVERT_TZ(${coluna}, '+00:00', '${FUSO}'))`;

/** Expressão SQL da chave do grupo: o primeiro dia do dia/semana (segunda)/mês. */
export function chaveDoGrupo(coluna: string, agrupar: Agrupamento): string {
  const d = diaLocal(coluna);
  if (agrupar === 'DIA') return `DATE_FORMAT(${d}, '%Y-%m-%d')`;
  if (agrupar === 'SEMANA') return `DATE_FORMAT(DATE_SUB(${d}, INTERVAL WEEKDAY(${d}) DAY), '%Y-%m-%d')`;
  return `DATE_FORMAT(${d}, '%Y-%m-01')`;
}

export interface Agregado {
  chave: string;
  forma: string;
  quantidade: number;
  total: number;
  troco: number;
  parcelas: number;
}

export interface AgregadoTickets {
  chave: string;
  encerrados: number;
  semCobranca: number;
  faturado: number;
  descontos: number;
}

export const relatoriosRepository = {
  /** Pagamentos registrados no período, por grupo de data e forma. */
  async recebimentos(siteId: string, de: string, ate: string, agrupar: Agrupamento): Promise<Agregado[]> {
    const [l] = await pool.query<RowDataPacket[]>(
      `SELECT ${chaveDoGrupo('registrado_em', agrupar)} AS chave, forma_codigo, COUNT(*) AS qtd,
              SUM(valor_centavos) AS total, SUM(troco_centavos) AS troco, SUM(parcelas) AS parcelas
         FROM pagamentos WHERE site_id = ? AND ${noPeriodo('registrado_em')}
        GROUP BY chave, forma_codigo`,
      [siteId, de, ate],
    );
    return l.map((x) => ({
      chave: String(x.chave),
      forma: String(x.forma_codigo),
      quantidade: n(x.qtd),
      total: n(x.total),
      troco: n(x.troco),
      parcelas: n(x.parcelas),
    }));
  },

  /** Estornos feitos no período (pela data do estorno), por grupo e forma. */
  async estornos(siteId: string, de: string, ate: string, agrupar: Agrupamento): Promise<Agregado[]> {
    const [l] = await pool.query<RowDataPacket[]>(
      `SELECT ${chaveDoGrupo('estornado_em', agrupar)} AS chave, forma_codigo, COUNT(*) AS qtd, SUM(valor_centavos) AS total
         FROM pagamentos WHERE site_id = ? AND status = 'ESTORNADO' AND ${noPeriodo('estornado_em')}
        GROUP BY chave, forma_codigo`,
      [siteId, de, ate],
    );
    return l.map((x) => ({
      chave: String(x.chave),
      forma: String(x.forma_codigo),
      quantidade: n(x.qtd),
      total: n(x.total),
      troco: 0,
      parcelas: 0,
    }));
  },

  /** Tickets encerrados no período (pela data da saída), por grupo. */
  async tickets(siteId: string, de: string, ate: string, agrupar: Agrupamento): Promise<AgregadoTickets[]> {
    const [l] = await pool.query<RowDataPacket[]>(
      `SELECT ${chaveDoGrupo('saida_em', agrupar)} AS chave, COUNT(*) AS encerrados,
              SUM(valor_final_centavos = 0) AS sem_cobranca, SUM(valor_final_centavos) AS faturado,
              SUM(desconto_centavos) AS descontos
         FROM sessoes_estacionamento
        WHERE site_id = ? AND status = 'ENCERRADA' AND ${noPeriodo('saida_em')}
        GROUP BY chave`,
      [siteId, de, ate],
    );
    return l.map((x) => ({
      chave: String(x.chave),
      encerrados: n(x.encerrados),
      semCobranca: n(x.sem_cobranca),
      faturado: n(x.faturado),
      descontos: n(x.descontos),
    }));
  },

  async nomesFormas(): Promise<Record<string, string>> {
    const [l] = await pool.query<RowDataPacket[]>('SELECT codigo, nome FROM formas_pagamento ORDER BY ordem');
    return Object.fromEntries(l.map((x) => [String(x.codigo), String(x.nome)]));
  },

  async ordemFormas(): Promise<string[]> {
    const [l] = await pool.query<RowDataPacket[]>('SELECT codigo FROM formas_pagamento ORDER BY ordem');
    return l.map((x) => String(x.codigo));
  },

  /** Caixas FECHADOS no período (pela data do fechamento). */
  async fechamentos(siteId: string, de: string, ate: string, operadorId?: string): Promise<CaixaResumo[]> {
    const where = [`cx.site_id = ?`, `cx.status = 'FECHADO'`, noPeriodo('cx.fechado_em')];
    const params: unknown[] = [siteId, de, ate];
    if (operadorId) {
      where.push('cx.operador_id = ?');
      params.push(operadorId);
    }
    const [l] = await pool.query<RowDataPacket[]>(
      `${SELECT_CAIXA} WHERE ${where.join(' AND ')} ORDER BY cx.fechado_em DESC LIMIT 500`,
      params,
    );
    return montarCaixas(pool, l);
  },

  async movimentacao(siteId: string, id: string): Promise<Movimentacao | null> {
    const [[l]] = await pool.query<RowDataPacket[]>(`${SELECT_MOV} WHERE m.site_id = ? AND m.id = ?`, [
      siteId,
      id,
    ]);
    return l ? paraMovimentacao(l) : null;
  },

  async movimentacoesDe(
    siteId: string,
    o: { pagamentoId?: string | null; sessaoId?: string | null },
  ): Promise<Movimentacao[]> {
    if (!o.pagamentoId && !o.sessaoId) return [];
    const [l] = await pool.query<RowDataPacket[]>(
      `${SELECT_MOV} WHERE m.site_id = ? AND (m.pagamento_id = ? OR m.sessao_id = ?) ORDER BY m.registrado_em, m.id`,
      [siteId, o.pagamentoId ?? '', o.sessaoId ?? ''],
    );
    return l.map(paraMovimentacao);
  },

  async pagamento(siteId: string, id: string): Promise<PagamentoRegistro | null> {
    const [[l]] = await pool.query<RowDataPacket[]>(
      `SELECT p.*, s.numero, s.placa, s.status AS sessao_status, fp.nome AS forma_nome, pt.nome AS posto,
              ${nome('p.registrado_por')} AS registrado_por_nome, ${nome('p.estornado_por')} AS estornado_por_nome
         FROM pagamentos p
         JOIN sessoes_estacionamento s ON s.id = p.sessao_id
         JOIN formas_pagamento fp ON fp.codigo = p.forma_codigo
         LEFT JOIN caixa_sessoes cx ON cx.id = p.caixa_sessao_id
         LEFT JOIN postos pt ON pt.id = cx.posto_id
        WHERE p.site_id = ? AND p.id = ?`,
      [siteId, id],
    );
    return l ? paraPagamento(l) : null;
  },

  /** Histórico de atividades das entidades informadas (pagamento, movimentação). */
  async historico(entidades: { entidade: string; id: string }[]): Promise<EventoHistorico[]> {
    if (!entidades.length) return [];
    const cond = entidades.map(() => '(h.entidade = ? AND h.entidade_id = ?)').join(' OR ');
    const [l] = await pool.query<RowDataPacket[]>(
      `SELECT h.acao, h.criado_em, h.motivo, ${nome('h.usuario_id')} AS usuario
         FROM historico_atividades h WHERE ${cond} ORDER BY h.criado_em, h.id`,
      entidades.flatMap((e) => [e.entidade, e.id]),
    );
    return l.map((x) => ({
      acao: String(x.acao),
      em: (x.criado_em as Date).toISOString(),
      usuario: (x.usuario as string | null) ?? null,
      motivo: (x.motivo as string | null) ?? null,
    }));
  },
};
