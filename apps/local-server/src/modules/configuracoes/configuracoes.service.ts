import type { RowDataPacket } from 'mysql2';
import {
  HORAS_APOS_SAIDA_MAX,
  POLITICA_ACESSO_PADRAO,
  type PoliticaAcessoCliente,
} from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import { pool, type Conexao } from '../../db/pool.js';
import { publicarSite } from '../../sync/outbox.js';
import { comTransacao, type ContextoAuditoria } from '../../db/transacao.js';
import { CHAVE_TABELA, limparCacheConfig, type ChaveConfig, type MapaConfig } from './preferencias.js';

/** Chave na tabela `configuracoes` (alterações auditadas pelos triggers). */
export const CHAVE_ACESSO_CLIENTE = 'acesso_cliente';

function normalizar(valor: unknown): PoliticaAcessoCliente {
  const v = (typeof valor === 'string' ? JSON.parse(valor) : valor) as Partial<PoliticaAcessoCliente> | null;
  const h = Number(v?.horasAposSaida);
  return {
    horasAposSaida:
      Number.isInteger(h) && h >= 0 && h <= HORAS_APOS_SAIDA_MAX ? h : POLITICA_ACESSO_PADRAO.horasAposSaida,
  };
}

export const configuracoesService = {
  /** Política em vigor (padrão: 24h após a saída). */
  async politicaAcessoCliente(siteId: string, c?: Conexao): Promise<PoliticaAcessoCliente> {
    const [[l]] = await (c ?? pool).query<RowDataPacket[]>(
      'SELECT valor FROM configuracoes WHERE site_id = ? AND chave = ?',
      [siteId, CHAVE_ACESSO_CLIENTE],
    );
    return l ? normalizar(l.valor) : { ...POLITICA_ACESSO_PADRAO };
  },

  /**
   * Altera a política. Vale para as próximas saídas: tickets já encerrados
   * mantêm o prazo calculado na saída deles.
   */
  async definirPoliticaAcessoCliente(
    usuarioId: string,
    contexto: ContextoAuditoria,
    p: PoliticaAcessoCliente,
  ): Promise<PoliticaAcessoCliente> {
    const site = await obterSiteAtual();
    await comTransacao(contexto, async (c) => {
      await c.query(
        `INSERT INTO configuracoes (site_id, chave, valor, descricao, atualizado_por)
         VALUES (?, ?, ?, 'Por quanto tempo o link do cliente funciona após a saída', ?)
         ON DUPLICATE KEY UPDATE valor = VALUES(valor), atualizado_por = VALUES(atualizado_por)`,
        [site.id, CHAVE_ACESSO_CLIENTE, JSON.stringify(p), usuarioId],
      );
      // A nuvem precisa saber a política (o app do cliente informa o prazo do link)
      await publicarSite(c, site.id);
    });
    return this.politicaAcessoCliente(site.id);
  },
};

// ---------------------------------------------------------------------------
// Configurações por categoria
// ---------------------------------------------------------------------------
type Valores = MapaConfig[ChaveConfig];

const DESCRICOES: Record<ChaveConfig, string> = {
  estacionamento: 'Dados do estacionamento',
  logo: 'Logotipo do estacionamento',
  operacao: 'Preferências de entrada e saída',
  seguranca: 'Regras de sessão, senha e acesso',
  limitesAjuste: 'Limite de desconto por nível',
  notificacoes: 'Alertas exibidos no painel',
  backup: 'Agenda do backup automático',
};

/** Grava uma categoria (o histórico registra antes → depois pelos triggers). */
export async function salvarCategoria(
  chave: ChaveConfig,
  valor: Valores,
  usuarioId: string,
  contexto: ContextoAuditoria,
): Promise<void> {
  const site = await obterSiteAtual();
  await comTransacao(contexto, async (c) => {
    await c.query(
      `INSERT INTO configuracoes (site_id, chave, valor, descricao, atualizado_por)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE valor = VALUES(valor), atualizado_por = VALUES(atualizado_por)`,
      [site.id, CHAVE_TABELA[chave], JSON.stringify(valor), DESCRICOES[chave], usuarioId],
    );
  });
  limparCacheConfig();
}

/** Quem alterou cada categoria por último. */
export async function ultimasAlteracoes(): Promise<Record<string, { em: string; por: string | null }>> {
  const site = await obterSiteAtual();
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT c.chave, c.atualizado_em, COALESCE(f.nome, u.login) AS nome
       FROM configuracoes c
       LEFT JOIN usuarios u ON u.id = c.atualizado_por
       LEFT JOIN funcionarios f ON f.usuario_id = u.id
      WHERE c.site_id = ?`,
    [site.id],
  );
  const porTabela = new Map(Object.entries(CHAVE_TABELA).map(([k, v]) => [v, k]));
  return Object.fromEntries(
    linhas.map((l) => [
      porTabela.get(String(l.chave)) ??
        (String(l.chave) === CHAVE_ACESSO_CLIENTE ? 'acessoCliente' : String(l.chave)),
      { em: (l.atualizado_em as Date).toISOString(), por: (l.nome as string | null) ?? null },
    ]),
  );
}
