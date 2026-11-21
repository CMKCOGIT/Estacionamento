import { createHmac, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { pool } from './db/pool.js';

/**
 * Registro de requisições RELEVANTES e erros (tabela registro_api), além do
 * log de todas as requisições (pino). Nunca grava token, segredo, corpo das
 * requisições nem IP em claro (só um HMAC do IP, para ver repetições).
 */
export type TipoRegistro =
  | 'sync.lote'
  | 'sync.snapshot'
  | 'sync.rejeitado'
  | 'sync.vinculado'
  | 'auth.recusada'
  | 'limite.excedido'
  | 'requisicao.invalida'
  | 'erro.interno';

const chaveIp = env.CHAVE_REGISTRO ?? randomBytes(32).toString('hex');
export const hashIp = (ip: string | undefined) =>
  ip ? createHmac('sha256', chaveIp).update(ip).digest('hex').slice(0, 16) : null;

export async function registrar(
  req: Request | null,
  r: {
    nivel?: 'info' | 'warn' | 'error';
    tipo: TipoRegistro;
    status?: number;
    integracaoId?: string | null;
    siteId?: string | null;
    detalhes?: Record<string, unknown>;
  },
): Promise<void> {
  const nivel = r.nivel ?? 'info';
  const linha = {
    tipo: r.tipo,
    status: r.status,
    integracaoId: r.integracaoId,
    siteId: r.siteId,
    ...r.detalhes,
  };
  (req?.log ?? logger)[nivel](linha, `registro: ${r.tipo}`);
  try {
    await pool.query(
      `INSERT INTO registro_api (nivel, tipo, metodo, rota, status, requisicao_id, integracao_id, site_id, ip_hash, detalhes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nivel,
        r.tipo,
        req?.method ?? null,
        req ? (req.originalUrl.split('?')[0] ?? '').slice(0, 120) : null,
        r.status ?? null,
        req ? String(req.id ?? '').slice(0, 36) || null : null,
        r.integracaoId ?? null,
        r.siteId ?? null,
        hashIp(req?.ip),
        r.detalhes ? JSON.stringify(r.detalhes) : null,
      ],
    );
  } catch (erro) {
    // O registro nunca derruba a requisição
    logger.warn({ err: erro }, 'Não foi possível gravar no registro da API');
  }
}
