import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Pool de conexões com o MySQL local.
 *
 * - Datas trafegam em UTC: o driver converte com `timezone: 'Z'` e cada
 *   conexão nova recebe `SET time_zone = '+00:00'` (os DEFAULT CURRENT_TIMESTAMP
 *   e os triggers dependem disso).
 * - BIGINT (ex.: seq da outbox) volta como string para não perder precisão.
 */
export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: env.DB_POOL_SIZE,
  waitForConnections: true,
  queueLimit: 0,
  charset: 'UTF8MB4_0900_AI_CI',
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: true,
  enableKeepAlive: true,
  connectTimeout: 5_000,
});

pool.on('connection', (conexao) => {
  conexao.query("SET time_zone = '+00:00'");
  logger.debug({ threadId: conexao.threadId }, 'Nova conexão MySQL aberta');
});

export type Conexao = mysql.PoolConnection;

export async function fecharPool(): Promise<void> {
  await pool.end();
}
