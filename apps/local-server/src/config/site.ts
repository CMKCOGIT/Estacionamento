import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import { AppError } from '../http/erros.js';
import { env } from './env.js';

/**
 * Estabelecimento atendido por este servidor local.
 * Usa SITE_ID do .env; se não estiver definido e houver um único site ativo
 * no banco (caso da v1), usa esse. Resultado guardado em memória.
 */
let siteAtual: { id: string; nome: string } | null = null;

export async function obterSiteAtual(): Promise<{ id: string; nome: string }> {
  if (siteAtual) return siteAtual;
  const [linhas] = env.SITE_ID
    ? await pool.query<RowDataPacket[]>('SELECT id, nome FROM sites WHERE id = ? AND ativo = TRUE', [
        env.SITE_ID,
      ])
    : await pool.query<RowDataPacket[]>('SELECT id, nome FROM sites WHERE ativo = TRUE LIMIT 2');

  if (linhas.length === 0) {
    throw new AppError(
      503,
      'SISTEMA_NAO_CONFIGURADO',
      'Nenhum estacionamento cadastrado. Rode "npm run usuario:admin" para fazer a configuração inicial.',
    );
  }
  if (linhas.length > 1) {
    throw new AppError(
      503,
      'SISTEMA_NAO_CONFIGURADO',
      'Há mais de um estacionamento cadastrado: defina SITE_ID no .env.',
    );
  }
  siteAtual = { id: String(linhas[0]?.id), nome: String(linhas[0]?.nome) };
  return siteAtual;
}

/** Usado após a instalação inicial e nos testes. */
export function esquecerSiteAtual(): void {
  siteAtual = null;
}
