import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { EstacionamentoPublico, ItemCalculo, RegraTarifa } from '@estacionamento/shared';
import { pool } from '../../db/pool.js';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

function estacionamento(l: RowDataPacket): EstacionamentoPublico {
  return {
    slug: String(l.slug),
    nome: String(l.nome),
    endereco: (l.endereco as string | null) ?? null,
    telefone: (l.telefone as string | null) ?? null,
    sincronizadoEm: iso(l.site_sincronizado_em ?? l.sincronizado_em),
  };
}

export interface TicketLido {
  estacionamento: EstacionamentoPublico;
  numero: string;
  placa: string;
  categoria: string;
  vaga: string | null;
  modalidade: 'AVULSO' | 'DIARIA';
  situacao: 'ESTACIONADO' | 'ENCERRADO' | 'CANCELADO';
  entradaEm: Date;
  saidaEm: Date | null;
  regra: RegraTarifa;
  tarifaDescricao: string;
  tarifaNome: string | null;
  horasAcessoAposSaida: number;
  valorFinalCentavos: number | null;
  itensFinal: ItemCalculo[] | null;
  pagoCentavos: number;
  acessoExpiraEm: Date | null;
  sincronizadoEm: Date;
  agora: Date;
}

/** Registro público do ticket na nuvem: 30 dias após a saída (ARQUITETURA §9). */
export const DIAS_RETENCAO_NUVEM = 30;

export const publicoRepository = {
  async site(slug: string): Promise<(EstacionamentoPublico & { id: string }) | null> {
    const [[l]] = await pool.query<RowDataPacket[]>('SELECT * FROM sites_publicos WHERE slug = ? AND ativo', [
      slug,
    ]);
    return l ? { id: String(l.id), ...estacionamento(l) } : null;
  },

  async disponibilidade(siteId: string) {
    const [l] = await pool.query<RowDataPacket[]>(
      'SELECT categoria, total, livres, atualizado_em FROM disponibilidade_publica WHERE site_id = ? ORDER BY ordem, categoria',
      [siteId],
    );
    return l.map((x) => ({
      categoria: String(x.categoria),
      total: Number(x.total),
      livres: Number(x.livres),
      atualizadoEm: x.atualizado_em as Date,
    }));
  },

  async tarifas(siteId: string) {
    // A tabela em vigor: a de início mais recente que já começou (uma publicada para o futuro espera a data)
    const [[vigente]] = await pool.query<RowDataPacket[]>(
      `SELECT tabela_id, vigente_desde FROM tarifas_publicas WHERE site_id = ? AND vigente_desde <= NOW(3)
        ORDER BY vigente_desde DESC, tabela_versao DESC LIMIT 1`,
      [siteId],
    );
    if (!vigente) return [];
    const [l] = await pool.query<RowDataPacket[]>(
      `SELECT categoria, nome, especial, condicao, linhas, vigente_desde FROM tarifas_publicas
        WHERE site_id = ? AND tabela_id <=> ? AND vigente_desde = ? ORDER BY ordem, especial, nome`,
      [siteId, vigente.tabela_id, vigente.vigente_desde],
    );
    return l.map((x) => ({
      categoria: String(x.categoria),
      nome: String(x.nome),
      especial: Boolean(Number(x.especial)),
      condicao: (x.condicao as string | null) ?? null,
      linhas: json<string[]>(x.linhas),
      vigenteDesde: x.vigente_desde as Date,
    }));
  },

  /**
   * O ticket do token (pelo hash). Só devolve se o token não foi revogado,
   * o ticket está num site ativo e o acesso não expirou — tudo numa consulta.
   */
  async ticketPorToken(hash: Buffer): Promise<TicketLido | null> {
    const [[l]] = await pool.query<RowDataPacket[]>(
      `SELECT t.*, s.slug, s.nome, s.endereco, s.telefone, s.horas_acesso_apos_saida,
              s.sincronizado_em AS site_sincronizado_em, NOW(3) AS agora
         FROM tickets_tokens k
         JOIN tickets_publicos t ON t.id = k.ticket_id
         JOIN sites_publicos s ON s.id = t.site_id AND s.ativo
        WHERE k.token_hash = ? AND k.revogado_em IS NULL
          AND (t.acesso_expira_em IS NULL OR t.acesso_expira_em > NOW(3))`,
      [hash],
    );
    if (!l) return null;
    return {
      estacionamento: estacionamento(l),
      numero: String(l.numero),
      placa: String(l.placa),
      categoria: String(l.categoria),
      vaga: (l.vaga as string | null) ?? null,
      modalidade: l.modalidade,
      situacao: l.situacao,
      entradaEm: l.entrada_em as Date,
      saidaEm: (l.saida_em as Date | null) ?? null,
      regra: json<RegraTarifa>(l.regra),
      tarifaDescricao: String(l.tarifa_descricao),
      tarifaNome: (l.tarifa_nome as string | null) ?? null,
      horasAcessoAposSaida: Number(l.horas_acesso_apos_saida),
      valorFinalCentavos: l.valor_final_centavos === null ? null : Number(l.valor_final_centavos),
      itensFinal: l.itens_final === null ? null : json<ItemCalculo[]>(l.itens_final),
      pagoCentavos: Number(l.pago_centavos),
      acessoExpiraEm: (l.acesso_expira_em as Date | null) ?? null,
      sincronizadoEm: l.sincronizado_em as Date,
      agora: l.agora as Date,
    };
  },

  /**
   * Retenção (ARQUITETURA §9): o acesso pelo link termina no prazo da
   * política (a consulta acima já recusa), e o registro público é APAGADO
   * 30 dias após a saída/cancelamento (placa é dado pessoal; o servidor
   * local continua com o histórico). Devolve quantos tickets saíram.
   */
  async apagarRegistrosVencidos(): Promise<number> {
    const vencido = `t.acesso_expira_em IS NOT NULL
      AND COALESCE(t.saida_em, t.acesso_expira_em) <= NOW(3) - INTERVAL ${DIAS_RETENCAO_NUVEM} DAY`;
    await pool.query(
      `DELETE k FROM tickets_tokens k JOIN tickets_publicos t ON t.id = k.ticket_id WHERE ${vencido}`,
    );
    const [r] = await pool.query<ResultSetHeader>(`DELETE t FROM tickets_publicos t WHERE ${vencido}`);
    return r.affectedRows;
  },
};
