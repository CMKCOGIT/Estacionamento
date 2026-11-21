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
