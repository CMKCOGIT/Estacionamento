import type { RowDataPacket } from 'mysql2/promise';
import type {
  CaixaResumo,
  Movimentacao,
  PagamentoRegistro,
  ResumoFinanceiroDia,
  TipoMovimentacao,
} from '@estacionamento/shared';
import { env } from '../../config/env.js';
import type { Conexao } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

type Db = Conexao | typeof pool;
export const FUSO = env.FUSO_OFFSET;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const n = (v: unknown) => Number(v ?? 0);
const nulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export const nome = (coluna: string) =>
  `(SELECT COALESCE(f.nome, u.login) FROM usuarios u LEFT JOIN funcionarios f ON f.usuario_id = u.id WHERE u.id = ${coluna})`;

/** Início do dia local `data` (AAAA-MM-DD) em UTC — os horários estão gravados em UTC. */
const inicioDoDia = (param = '?') => `CONVERT_TZ(CAST(${param} AS DATETIME), '${FUSO}', '+00:00')`;
/** Condição "coluna dentro dos dias locais de..até" (inclusive). */
export const noPeriodo = (coluna: string) =>
  `${coluna} >= ${inicioDoDia()} AND ${coluna} < ${inicioDoDia()} + INTERVAL 1 DAY`;

/** Acrescenta a condição só quando o filtro foi informado. */
function se(where: string[], params: unknown[], valor: unknown, condicao: string) {
  if (valor === undefined || valor === null || valor === '') return;
  where.push(condicao);
  params.push(valor);
}

export interface Pagina {
  pagina: number;
  limite: number;
}

// ---------------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------------
export interface FiltroPagamentos {
  de: string;
  ate: string;
  forma?: string;
  status?: 'CONFIRMADO' | 'ESTORNADO';
  caixaId?: string;
  sessaoId?: string;
  busca?: string;
}

function filtroPagamentos(f: FiltroPagamentos) {
  const where = ['p.site_id = ?', noPeriodo('p.registrado_em')];
  const params: unknown[] = [f.de, f.ate];
  se(where, params, f.forma, 'p.forma_codigo = ?');
  se(where, params, f.status, 'p.status = ?');
  se(where, params, f.caixaId, 'p.caixa_sessao_id = ?');
  se(where, params, f.sessaoId, 'p.sessao_id = ?');
  if (f.busca) {
    where.push('(s.placa LIKE ? OR s.numero = ?)');
    params.push(
      `%${f.busca.replace(/[^A-Z0-9]/gi, '').toUpperCase()}%`,
      /^\d+$/.test(f.busca) ? Number(f.busca) : -1,
    );
  }
  return { where: where.join(' AND '), params };
}

export function paraPagamento(l: RowDataPacket): PagamentoRegistro {
  return {
    id: l.id,
    sessaoId: l.sessao_id,
    ticketNumero: String(l.numero),
    placa: l.placa,
    sessaoStatus: l.sessao_status,
    forma: l.forma_codigo,
    formaNome: l.forma_nome,
    valorCentavos: n(l.valor_centavos),
    valorRecebidoCentavos: nulo(l.valor_recebido_centavos),
    trocoCentavos: n(l.troco_centavos),
    parcelas: n(l.parcelas),
    autorizacao: l.autorizacao ?? null,
    status: l.status,
    registradoEm: iso(l.registrado_em) ?? '',
    registradoPor: l.registrado_por_nome ?? null,
    caixaId: l.caixa_sessao_id ?? null,
    posto: l.posto ?? null,
    estornadoEm: iso(l.estornado_em),
    estornadoPor: l.estornado_por_nome ?? null,
    motivoEstorno: l.motivo_estorno ?? null,
  };
}

// ---------------------------------------------------------------------------
// Movimentações
// ---------------------------------------------------------------------------
export interface FiltroMovimentacoes {
  de: string;
  ate: string;
  caixaId?: string;
  tipo?: TipoMovimentacao;
  forma?: string;
}

export function paraMovimentacao(l: RowDataPacket): Movimentacao {
  return {
    id: l.id,
    tipo: l.tipo,
    direcao: l.direcao,
    valorCentavos: n(l.valor_centavos),
    forma: l.forma_codigo,
    formaNome: l.forma_nome,
    caixaId: l.caixa_sessao_id ?? null,
    posto: l.posto ?? null,
    registradoEm: iso(l.registrado_em) ?? '',
    registradoPor: l.registrado_por_nome ?? null,
    descricao: l.descricao ?? null,
    sessaoId: l.sessao_id ?? null,
    ticketNumero: l.numero === null || l.numero === undefined ? null : String(l.numero),
    placa: l.placa ?? null,
    pagamentoId: l.pagamento_id ?? null,
  };
}

export const SELECT_MOV = `
  SELECT m.*, f.nome AS forma_nome, pt.nome AS posto, s.numero, s.placa, ${nome('m.registrado_por')} AS registrado_por_nome
    FROM movimentacoes_financeiras m
    JOIN formas_pagamento f ON f.codigo = m.forma_codigo
    LEFT JOIN caixa_sessoes cx ON cx.id = m.caixa_sessao_id
    LEFT JOIN postos pt ON pt.id = cx.posto_id
    LEFT JOIN sessoes_estacionamento s ON s.id = m.sessao_id`;

// ---------------------------------------------------------------------------
// Caixas
// ---------------------------------------------------------------------------
export const SELECT_CAIXA = `
  SELECT cx.*, pt.nome AS posto, ${nome('cx.operador_id')} AS operador, ${nome('cx.fechado_por')} AS fechado_por_nome
    FROM caixa_sessoes cx JOIN postos pt ON pt.id = cx.posto_id`;

export async function montarCaixas(c: Db, linhas: RowDataPacket[]): Promise<CaixaResumo[]> {
  if (!linhas.length) return [];
  const ids = linhas.map((l) => l.id as string);
  const [porForma] = await c.query<RowDataPacket[]>(
    `SELECT r.*, f.nome FROM vw_caixa_resumo r JOIN formas_pagamento f ON f.codigo = r.forma_codigo
      WHERE r.caixa_sessao_id IN (?) ORDER BY f.ordem`,
    [ids],
  );
  const [porTipo] = await c.query<RowDataPacket[]>(
    `SELECT caixa_sessao_id, tipo, COUNT(*) AS qtd, SUM(valor_centavos) AS total
       FROM movimentacoes_financeiras WHERE caixa_sessao_id IN (?) GROUP BY caixa_sessao_id, tipo`,
    [ids],
  );
  return linhas.map((l) => {
    const formas = porForma.filter((f) => f.caixa_sessao_id === l.id);
    const tipo = (t: string) => porTipo.find((x) => x.caixa_sessao_id === l.id && x.tipo === t);
    const dinheiro = n(formas.find((f) => f.forma_codigo === 'DINHEIRO')?.saldo_centavos);
    return {
      id: l.id,
      posto: l.posto,
      operador: l.operador,
      operadorId: l.operador_id,
      status: l.status,
      abertoEm: iso(l.aberto_em) ?? '',
      fechadoEm: iso(l.fechado_em),
      fechadoPor: l.fechado_por_nome ?? null,
      saldoInicialCentavos: n(l.saldo_inicial_centavos),
      // Fechado: vale o esperado gravado no fechamento
      dinheiroEsperadoCentavos: l.status === 'FECHADO' ? n(l.saldo_esperado_centavos) : dinheiro,
      saldoContadoCentavos: nulo(l.saldo_contado_centavos),
      diferencaCentavos: nulo(l.diferenca_centavos),
      observacao: l.observacao_fechamento ?? null,
      quantidadeRecebimentos: n(tipo('RECEBIMENTO')?.qtd),
      recebidoCentavos: n(tipo('RECEBIMENTO')?.total),
      estornadoCentavos: n(tipo('ESTORNO')?.total),
      sangriasCentavos: n(tipo('SANGRIA')?.total),
      suprimentosCentavos: n(tipo('SUPRIMENTO')?.total),
      porForma: formas.map((f) => ({
        forma: f.forma_codigo,
        nome: f.nome,
        entradasCentavos: n(f.entradas_centavos),
        saidasCentavos: n(f.saidas_centavos),
        saldoCentavos: n(f.saldo_centavos),
      })),
    };
  });
}

export const financeiroRepository = {
  async hojeLocal(): Promise<string> {
    const [[l]] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(CONVERT_TZ(NOW(3), '+00:00', '${FUSO}'), '%Y-%m-%d') AS hoje`,
    );
    return String(l?.hoje);
  },

  async pagamentos(siteId: string, f: FiltroPagamentos, p: Pagina) {
    const { where, params } = filtroPagamentos(f);
    const base = `FROM pagamentos p JOIN sessoes_estacionamento s ON s.id = p.sessao_id WHERE ${where}`;
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT p.*, s.numero, s.placa, s.status AS sessao_status, fp.nome AS forma_nome, pt.nome AS posto,
              ${nome('p.registrado_por')} AS registrado_por_nome, ${nome('p.estornado_por')} AS estornado_por_nome
         FROM pagamentos p
         JOIN sessoes_estacionamento s ON s.id = p.sessao_id
         JOIN formas_pagamento fp ON fp.codigo = p.forma_codigo
         LEFT JOIN caixa_sessoes cx ON cx.id = p.caixa_sessao_id
         LEFT JOIN postos pt ON pt.id = cx.posto_id
        WHERE ${where}
        ORDER BY p.registrado_em DESC, p.id DESC
        LIMIT ? OFFSET ?`,
      [siteId, ...params, p.limite + 1, (p.pagina - 1) * p.limite],
    );
    const [[t]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS qtd,
              COALESCE(SUM(CASE WHEN p.status = 'CONFIRMADO' THEN p.valor_centavos END), 0) AS confirmados,
              COALESCE(SUM(CASE WHEN p.status = 'ESTORNADO' THEN p.valor_centavos END), 0) AS estornados
         ${base}`,
      [siteId, ...params],
    );
    return {
      itens: linhas.slice(0, p.limite).map(paraPagamento),
      totais: {
        quantidade: n(t?.qtd),
        confirmadosCentavos: n(t?.confirmados),
        estornadosCentavos: n(t?.estornados),
      },
      proximaPagina: linhas.length > p.limite ? p.pagina + 1 : null,
    };
  },

  async movimentacoes(siteId: string, f: FiltroMovimentacoes, p: Pagina) {
    const where = ['m.site_id = ?', noPeriodo('m.registrado_em')];
    const params: unknown[] = [siteId, f.de, f.ate];
    se(where, params, f.caixaId, 'm.caixa_sessao_id = ?');
    se(where, params, f.tipo, 'm.tipo = ?');
    se(where, params, f.forma, 'm.forma_codigo = ?');
    const w = where.join(' AND ');
    const [linhas] = await pool.query<RowDataPacket[]>(
      `${SELECT_MOV} WHERE ${w} ORDER BY m.registrado_em DESC, m.id DESC LIMIT ? OFFSET ?`,
      [...params, p.limite + 1, (p.pagina - 1) * p.limite],
    );
    const [[t]] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(CASE WHEN m.direcao = 'ENTRADA' THEN m.valor_centavos END), 0) AS entradas,
              COALESCE(SUM(CASE WHEN m.direcao = 'SAIDA' THEN m.valor_centavos END), 0) AS saidas
         FROM movimentacoes_financeiras m WHERE ${w}`,
      params,
    );
    return {
      itens: linhas.slice(0, p.limite).map(paraMovimentacao),
      totais: { entradasCentavos: n(t?.entradas), saidasCentavos: n(t?.saidas) },
      proximaPagina: linhas.length > p.limite ? p.pagina + 1 : null,
    };
  },

  async movimentacoesDoCaixa(c: Db, caixaId: string): Promise<Movimentacao[]> {
    const [l] = await c.query<RowDataPacket[]>(
      `${SELECT_MOV} WHERE m.caixa_sessao_id = ? ORDER BY m.registrado_em, m.id`,
      [caixaId],
    );
    return l.map(paraMovimentacao);
  },

  async caixa(c: Db, siteId: string, id: string): Promise<CaixaResumo | null> {
    const [l] = await c.query<RowDataPacket[]>(`${SELECT_CAIXA} WHERE cx.site_id = ? AND cx.id = ?`, [
      siteId,
      id,
    ]);
    return (await montarCaixas(c, l))[0] ?? null;
  },

  /** Caixas abertos no período (e, se pedido, os que continuam abertos), mais recentes primeiro. */
  async caixas(
    siteId: string,
    f: { de: string; ate: string; operadorId?: string; incluirAbertos?: boolean },
  ): Promise<CaixaResumo[]> {
    const periodo = noPeriodo('cx.aberto_em');
    const where = [`cx.site_id = ?`, f.incluirAbertos ? `(${periodo} OR cx.status = 'ABERTO')` : periodo];
    const params: unknown[] = [siteId, f.de, f.ate];
    se(where, params, f.operadorId, 'cx.operador_id = ?');
    const [l] = await pool.query<RowDataPacket[]>(
      `${SELECT_CAIXA} WHERE ${where.join(' AND ')} ORDER BY cx.aberto_em DESC LIMIT 200`,
      params,
    );
    return montarCaixas(pool, l);
  },

  /** Números do dia local `data`. */
  async resumoDoDia(
    siteId: string,
    data: string,
  ): Promise<Omit<ResumoFinanceiroDia, 'caixas' | 'pendentes'>> {
    const dia = [data, data];
    const [[rec]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_centavos), 0) AS total, COALESCE(SUM(troco_centavos), 0) AS troco
         FROM pagamentos WHERE site_id = ? AND ${noPeriodo('registrado_em')}`,
      [siteId, ...dia],
    );
    const [[est]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_centavos), 0) AS total
         FROM pagamentos WHERE site_id = ? AND status = 'ESTORNADO' AND ${noPeriodo('estornado_em')}`,
      [siteId, ...dia],
    );
    const [formas] = await pool.query<RowDataPacket[]>(
      `SELECT f.codigo, f.nome,
              (SELECT COUNT(*) FROM pagamentos p WHERE p.site_id = ? AND p.forma_codigo = f.codigo AND ${noPeriodo('p.registrado_em')}) AS qtd,
              (SELECT COALESCE(SUM(valor_centavos), 0) FROM pagamentos p WHERE p.site_id = ? AND p.forma_codigo = f.codigo AND ${noPeriodo('p.registrado_em')}) AS recebido,
              (SELECT COALESCE(SUM(valor_centavos), 0) FROM pagamentos p WHERE p.site_id = ? AND p.forma_codigo = f.codigo
                  AND p.status = 'ESTORNADO' AND ${noPeriodo('p.estornado_em')}) AS estornado
         FROM formas_pagamento f WHERE f.ativo OR f.codigo IN (SELECT forma_codigo FROM pagamentos WHERE site_id = ?)
        ORDER BY f.ordem`,
      [siteId, ...dia, siteId, ...dia, siteId, ...dia, siteId],
    );
    const [horas] = await pool.query<RowDataPacket[]>(
      `SELECT HOUR(CONVERT_TZ(registrado_em, '+00:00', '${FUSO}')) AS hora, COUNT(*) AS qtd, SUM(valor_centavos) AS total
         FROM pagamentos WHERE site_id = ? AND ${noPeriodo('registrado_em')} GROUP BY hora ORDER BY hora`,
      [siteId, ...dia],
    );
    const [[tk]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS encerrados,
              SUM(valor_final_centavos = 0) AS sem_cobranca,
              COALESCE(SUM(valor_final_centavos), 0) AS faturado,
              COALESCE(SUM(desconto_centavos), 0) AS descontos
         FROM sessoes_estacionamento WHERE site_id = ? AND status = 'ENCERRADA' AND ${noPeriodo('saida_em')}`,
      [siteId, ...dia],
    );
    const pagos = n(tk?.encerrados) - n(tk?.sem_cobranca);
    return {
      data,
      recebidoCentavos: n(rec?.total),
      quantidadePagamentos: n(rec?.qtd),
      estornadoCentavos: n(est?.total),
      quantidadeEstornos: n(est?.qtd),
      liquidoCentavos: n(rec?.total) - n(est?.total),
      trocoCentavos: n(rec?.troco),
      ticketsEncerrados: n(tk?.encerrados),
      ticketsSemCobranca: n(tk?.sem_cobranca),
      ticketMedioCentavos: pagos > 0 ? Math.round(n(tk?.faturado) / pagos) : null,
      descontosCentavos: n(tk?.descontos),
      porForma: formas
        .filter((f) => n(f.qtd) > 0 || n(f.estornado) > 0)
        .map((f) => ({
          forma: f.codigo,
          nome: f.nome,
          quantidade: n(f.qtd),
          recebidoCentavos: n(f.recebido),
          estornadoCentavos: n(f.estornado),
          liquidoCentavos: n(f.recebido) - n(f.estornado),
        })),
      porHora: horas.map((h) => ({ hora: n(h.hora), quantidade: n(h.qtd), recebidoCentavos: n(h.total) })),
    };
  },
};
