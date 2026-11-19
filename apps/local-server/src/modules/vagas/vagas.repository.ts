import type { RowDataPacket } from 'mysql2/promise';
import {
  compararCodigos,
  type Categoria,
  type EstadoVaga,
  type UsoVaga,
  type Vaga,
} from '@estacionamento/shared';
import type { Conexao } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const flag = (v: unknown) => v !== null && v !== undefined && Number(v) !== 0;

/** Vaga + categoria + quem bloqueou + sessão aberta (se ocupada) + se já foi usada. */
const SELECT_VAGA = `
  SELECT v.id, v.codigo, v.setor, v.categoria_id, c.nome AS categoria, v.situacao, v.coberta, v.observacao,
         v.motivo_bloqueio, v.bloqueada_em, COALESCE(fb.nome, ub.login) AS bloqueada_por,
         v.criado_em, v.desativada_em,
         s.id AS sessao_id, s.numero, s.placa, s.entrada_em,
         TIMESTAMPDIFF(MINUTE, s.entrada_em, NOW(3)) AS permanencia,
         EXISTS (SELECT 1 FROM sessoes_estacionamento h WHERE h.vaga_id = v.id) AS tem_historico
    FROM vagas v
    JOIN categorias_veiculo c ON c.id = v.categoria_id
    LEFT JOIN sessoes_estacionamento s ON s.vaga_ocupada_id = v.id
    LEFT JOIN usuarios ub ON ub.id = v.bloqueada_por
    LEFT JOIN funcionarios fb ON fb.usuario_id = ub.id`;

function estado(l: RowDataPacket): EstadoVaga {
  if (l.situacao === 'INATIVA') return 'REMOVIDA';
  if (l.situacao === 'MANUTENCAO') return 'BLOQUEADA';
  return l.sessao_id ? 'OCUPADA' : 'LIVRE';
}

export function paraVaga(l: RowDataPacket): Vaga {
  return {
    id: l.id,
    codigo: l.codigo,
    setor: l.setor ?? null,
    categoriaId: l.categoria_id,
    categoria: l.categoria,
    estado: estado(l),
    coberta: flag(l.coberta),
    observacao: l.observacao ?? null,
    bloqueio:
      l.situacao === 'MANUTENCAO'
        ? { motivo: l.motivo_bloqueio, em: iso(l.bloqueada_em) ?? '', por: l.bloqueada_por ?? null }
        : null,
    ocupacao: l.sessao_id
      ? {
          sessaoId: l.sessao_id,
          numero: String(l.numero),
          placa: l.placa,
          entradaEm: iso(l.entrada_em) ?? '',
          permanenciaMin: Math.max(0, Number(l.permanencia)),
        }
      : null,
    temHistorico: flag(l.tem_historico),
  };
}

export interface LinhaVagaBruta {
  id: string;
  codigo: string;
  situacao: 'ATIVA' | 'MANUTENCAO' | 'INATIVA';
  ocupada: boolean;
  temHistorico: boolean;
}

export const vagasRepository = {
  async listar(siteId: string): Promise<Vaga[]> {
    const [linhas] = await pool.query<RowDataPacket[]>(`${SELECT_VAGA} WHERE v.site_id = ?`, [siteId]);
    return linhas
      .map(paraVaga)
      .sort((a, b) => (a.setor ?? '').localeCompare(b.setor ?? '') || compararCodigos(a.codigo, b.codigo));
  },

  async buscar(siteId: string, id: string, c?: Conexao) {
    const [[l]] = await (c ?? pool).query<RowDataPacket[]>(
      `${SELECT_VAGA} WHERE v.site_id = ? AND v.id = ?`,
      [siteId, id],
    );
    if (!l) return null;
    return { vaga: paraVaga(l), criadaEm: iso(l.criado_em) ?? '', desativadaEm: iso(l.desativada_em) };
  },

  async ultimosUsos(vagaId: string, limite = 10): Promise<UsoVaga[]> {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT id, numero, placa, entrada_em, saida_em, status FROM sessoes_estacionamento
        WHERE vaga_id = ? ORDER BY entrada_em DESC LIMIT ?`,
      [vagaId, limite],
    );
    return linhas.map((l) => ({
      sessaoId: l.id,
      numero: String(l.numero),
      placa: l.placa,
      entradaEm: iso(l.entrada_em) ?? '',
      saidaEm: iso(l.saida_em),
      status: l.status,
    }));
  },

  /** Vagas de uma categoria, com o necessário para decidir criar/reativar/remover. */
  async vagasDaCategoria(c: Conexao, categoriaId: string): Promise<LinhaVagaBruta[]> {
    const [linhas] = await c.query<RowDataPacket[]>(
      `SELECT v.id, v.codigo, v.situacao,
              EXISTS (SELECT 1 FROM sessoes_estacionamento s WHERE s.vaga_ocupada_id = v.id) AS ocupada,
              EXISTS (SELECT 1 FROM sessoes_estacionamento h WHERE h.vaga_id = v.id) AS tem_historico
         FROM vagas v WHERE v.categoria_id = ? FOR UPDATE`,
      [categoriaId],
    );
    return linhas.map((l) => ({
      id: l.id,
      codigo: l.codigo,
      situacao: l.situacao,
      ocupada: flag(l.ocupada),
      temHistorico: flag(l.tem_historico),
    }));
  },

  /** Trava a categoria: alterações de capacidade simultâneas ficam em fila. */
  async travarCategoria(c: Conexao, siteId: string, categoriaId: string) {
    const [[l]] = await c.query<RowDataPacket[]>(
      'SELECT id, codigo, nome, ativo FROM categorias_veiculo WHERE id = ? AND site_id = ? FOR UPDATE',
      [categoriaId, siteId],
    );
    return l
      ? { id: String(l.id), codigo: String(l.codigo), nome: String(l.nome), ativo: flag(l.ativo) }
      : null;
  },

  async capacidade(c: Conexao, categoriaId: string): Promise<number> {
    const [[l]] = await c.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM vagas WHERE categoria_id = ? AND situacao <> 'INATIVA'",
      [categoriaId],
    );
    return Number(l?.n ?? 0);
  },

  async codigosExistentes(c: Conexao, siteId: string, codigos: string[]): Promise<string[]> {
    if (!codigos.length) return [];
    const [l] = await c.query<RowDataPacket[]>(
      'SELECT codigo FROM vagas WHERE site_id = ? AND codigo IN (?)',
      [siteId, codigos],
    );
    return l.map((x) => String(x.codigo));
  },

  async todosCodigos(c: Conexao, siteId: string): Promise<string[]> {
    const [l] = await c.query<RowDataPacket[]>('SELECT codigo FROM vagas WHERE site_id = ?', [siteId]);
    return l.map((x) => String(x.codigo));
  },

  async listarCategorias(siteId: string): Promise<Categoria[]> {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.codigo, c.nome, c.ativo, c.ordem,
              (SELECT COUNT(*) FROM vagas v WHERE v.categoria_id = c.id AND v.situacao <> 'INATIVA') AS capacidade
         FROM categorias_veiculo c WHERE c.site_id = ? ORDER BY c.ordem, c.nome`,
      [siteId],
    );
    return linhas.map((l) => ({
      id: l.id,
      codigo: l.codigo,
      nome: l.nome,
      ativo: flag(l.ativo),
      ordem: Number(l.ordem),
      capacidade: Number(l.capacidade),
    }));
  },
};
