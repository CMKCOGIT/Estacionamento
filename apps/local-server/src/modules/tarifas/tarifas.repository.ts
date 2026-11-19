import type { RowDataPacket } from 'mysql2/promise';
import type {
  RegraCadastrada,
  SituacaoTabela,
  TabelaTarifaDetalhe,
  TabelaTarifaResumo,
} from '@estacionamento/shared';
import type { Conexao } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const n = (v: unknown) => Number(v ?? 0);
const nulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const hhmm = (v: unknown) => (v === null || v === undefined ? null : String(v).slice(0, 5));

const nomeUsuario = (coluna: string) =>
  `(SELECT COALESCE(f.nome, u.login) FROM usuarios u LEFT JOIN funcionarios f ON f.usuario_id = u.id WHERE u.id = ${coluna})`;

/** Subconsulta: id da tabela vigente agora (maior início de vigência já alcançado). */
export const SQL_TABELA_VIGENTE = `(SELECT tv.id FROM tabelas_tarifa tv
   WHERE tv.site_id = ? AND tv.status = 'PUBLICADA' AND tv.vigente_desde <= NOW(3)
   ORDER BY tv.vigente_desde DESC, tv.versao DESC LIMIT 1)`;

const SELECT_TABELA = `
  SELECT t.*, ${nomeUsuario('t.publicado_por')} AS publicado_por_nome, ${nomeUsuario('t.criado_por')} AS criado_por_nome,
         (SELECT COUNT(*) FROM sessoes_estacionamento s JOIN tarifa_regras r ON r.id = s.tarifa_regra_id
           WHERE r.tabela_id = t.id) AS tickets,
         t.id = ${SQL_TABELA_VIGENTE} AS e_vigente,
         t.vigente_desde > NOW(3) AS e_futura
    FROM tabelas_tarifa t`;

function resumo(l: RowDataPacket): TabelaTarifaResumo {
  const situacao: SituacaoTabela =
    l.status === 'RASCUNHO'
      ? 'RASCUNHO'
      : l.status === 'ARQUIVADA'
        ? 'ARQUIVADA'
        : Number(l.e_vigente)
          ? 'VIGENTE'
          : Number(l.e_futura)
            ? 'AGENDADA'
            : 'SUBSTITUIDA';
  return {
    id: l.id,
    versao: n(l.versao),
    nome: l.nome,
    descricao: l.descricao ?? null,
    status: l.status,
    situacao,
    vigenteDesde: iso(l.vigente_desde),
    publicadoEm: iso(l.publicado_em),
    publicadoPor: l.publicado_por_nome ?? null,
    criadoPor: l.criado_por_nome ?? null,
    criadoEm: iso(l.criado_em) ?? '',
    arquivadoEm: iso(l.arquivado_em),
    ticketsUsaram: n(l.tickets),
  };
}

export function regraCadastrada(l: RowDataPacket): RegraCadastrada {
  return {
    id: l.id,
    categoriaId: l.categoria_id,
    categoria: l.categoria,
    tipo: l.tipo,
    nome: l.nome ?? null,
    aplicacao: l.aplicacao ?? null,
    diasSemana: nulo(l.dias_semana),
    horaInicio: hhmm(l.hora_inicio),
    horaFim: hhmm(l.hora_fim),
    ativo: Boolean(Number(l.ativo)),
    ordem: n(l.ordem),
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

export const tarifasRepository = {
  async listar(siteId: string): Promise<TabelaTarifaResumo[]> {
    const [l] = await pool.query<RowDataPacket[]>(
      `${SELECT_TABELA} WHERE t.site_id = ? ORDER BY t.versao DESC`,
      [siteId, siteId],
    );
    return l.map(resumo);
  },

  async obter(
    siteId: string,
    id: string,
    c: Conexao | typeof pool = pool,
    travar = false,
  ): Promise<TabelaTarifaDetalhe | null> {
    const [[l]] = await c.query<RowDataPacket[]>(
      `${SELECT_TABELA} WHERE t.site_id = ? AND t.id = ?${travar ? ' FOR UPDATE OF t' : ''}`,
      [siteId, siteId, id],
    );
    if (!l) return null;
    return { ...resumo(l), regras: await this.regras(c, id) };
  },

  async regras(c: Conexao | typeof pool, tabelaId: string): Promise<RegraCadastrada[]> {
    const [l] = await c.query<RowDataPacket[]>(
      `SELECT r.*, c.nome AS categoria FROM tarifa_regras r JOIN categorias_veiculo c ON c.id = r.categoria_id
        WHERE r.tabela_id = ?
        ORDER BY c.ordem, c.nome, r.tipo = 'ESPECIAL', r.ordem, r.nome`,
      [tabelaId],
    );
    return l.map(regraCadastrada);
  },

  async idVigente(c: Conexao | typeof pool, siteId: string): Promise<string | null> {
    const [[l]] = await c.query<RowDataPacket[]>(`SELECT ${SQL_TABELA_VIGENTE} AS id`, [siteId]);
    return (l?.id as string | null) ?? null;
  },

  async rascunho(c: Conexao | typeof pool, siteId: string): Promise<string | null> {
    const [[l]] = await c.query<RowDataPacket[]>(
      "SELECT id FROM tabelas_tarifa WHERE site_id = ? AND status = 'RASCUNHO' ORDER BY versao DESC LIMIT 1",
      [siteId],
    );
    return (l?.id as string | null) ?? null;
  },

  /** Regras ativas da tabela vigente para a categoria (com dados da tabela). */
  async regrasVigentes(c: Conexao | typeof pool, siteId: string, categoriaId: string) {
    const [l] = await c.query<RowDataPacket[]>(
      `SELECT r.*, c.nome AS categoria, t.versao AS tabela_versao, t.nome AS tabela_nome, t.vigente_desde, NOW(3) AS agora
         FROM tarifa_regras r
         JOIN tabelas_tarifa t ON t.id = r.tabela_id
         JOIN categorias_veiculo c ON c.id = r.categoria_id
        WHERE r.tabela_id = ${SQL_TABELA_VIGENTE} AND r.categoria_id = ? AND r.ativo
        ORDER BY r.tipo = 'ESPECIAL', r.ordem, r.nome`,
      [siteId, categoriaId],
    );
    return l;
  },
};
