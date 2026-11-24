import { readFileSync } from 'node:fs';
import { env } from '../config/env.js';

/** Opções de TLS para o mysql2 (null = sem criptografia, só para MySQL local). */
export function opcoesSsl(): { ca?: string; rejectUnauthorized: true } | undefined {
  if (!env.DB_SSL) return undefined;
  const ca = env.DB_SSL_CA?.trim();
  if (!ca) return { rejectUnauthorized: true };
  // Texto PEM colado direto na variável (alguns painéis trocam a quebra de linha por \n)
  if (ca.includes('BEGIN CERTIFICATE')) return { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  return { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true };
}
