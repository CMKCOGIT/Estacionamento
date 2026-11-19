import type { RowDataPacket } from 'mysql2/promise';
import type { Conexao } from '../../db/pool.js';
import type { RegraTarifa, TarifaAplicada } from '@estacionamento/shared';

const n = (v: unknown) => Number(v ?? 0);
const nulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Colunas de preço de `tarifa_regras r` (para quem calcula valor). */
export const COLUNAS_REGRA = `r.tolerancia_min, r.primeira_hora_centavos, r.hora_adicional_centavos, r.fracao_min,
  r.fracao_centavos, r.carencia_min, r.diaria_maxima_centavos, r.diaria_centavos, r.valor_fixo_centavos`;

export function regraDaLinha(l: RowDataPacket): Required<RegraTarifa> {
  return {
    toleranciaMin: n(l.tolerancia_min),
    primeiraHoraCentavos: n(l.primeira_hora_centavos),
    horaAdicionalCentavos: n(l.hora_adicional_centavos),
    fracaoMin: nulo(l.fracao_min),
    fracaoCentavos: nulo(l.fracao_centavos),
    carenciaMin: n(l.carencia_min),
    diariaMaximaCentavos: nulo(l.diaria_maxima_centavos),
    diariaCentavos: nulo(l.diaria_centavos),
    valorFixoCentavos: nulo(l.valor_fixo_centavos),
  };
}

/** mysql2 devolve JSON já convertido; por garantia aceita texto. */
export function lerJson<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  return (typeof v === 'string' ? JSON.parse(v) : v) as T;
}

/**
 * Regra usada para cobrar o ticket: a cópia gravada na entrada
 * (`tarifa_aplicada`). Tickets antigos, de antes desse registro, usam a regra
 * referenciada — que também é imutável depois de publicada.
 */
export function regraDoTicket(l: RowDataPacket): Required<RegraTarifa> {
  return lerJson<TarifaAplicada>(l.tarifa_aplicada)?.regra ?? regraDaLinha(l);
}

/** Monta a cópia gravada no ticket a partir de uma regra já publicada. */
export async function tarifaAplicadaDaRegra(
  c: { query: Conexao['query'] },
  regraId: string,
  selecao: TarifaAplicada['selecao'] = 'PADRAO',
): Promise<TarifaAplicada> {
  const [[l]] = await c.query<RowDataPacket[]>(
    `SELECT r.*, c.nome AS categoria, t.versao AS tabela_versao, t.nome AS tabela_nome, t.vigente_desde
       FROM tarifa_regras r JOIN tabelas_tarifa t ON t.id = r.tabela_id JOIN categorias_veiculo c ON c.id = r.categoria_id
      WHERE r.id = ?`,
    [regraId],
  );
  if (!l) throw new Error(`Regra de tarifa ${regraId} não encontrada`);
  return {
    tabelaId: l.tabela_id,
    tabelaVersao: Number(l.tabela_versao),
    tabelaNome: l.tabela_nome,
    vigenteDesde: (l.vigente_desde as Date).toISOString(),
    regraId: l.id,
    tipo: l.tipo,
    nome: l.tipo === 'PADRAO' ? 'Padrão' : String(l.nome),
    categoria: l.categoria,
    selecao,
    regra: regraDaLinha(l),
  };
}
