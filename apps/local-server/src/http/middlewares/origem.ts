import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../erros.js';

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defesa extra contra CSRF (além do cookie SameSite=Strict): requisições que
 * alteram dados vindas de navegador precisam ter Origin do próprio servidor
 * ou de uma origem liberada em CORS_ORIGINS (ex.: Vite em desenvolvimento).
 * Requisições sem Origin (scripts, testes, curl) não são afetadas.
 */
export const verificarOrigem: RequestHandler = (req, _res, next) => {
  if (METODOS_SEGUROS.has(req.method)) return next();
  const origem = req.get('origin');
  if (!origem) return next();

  let hostDaOrigem: string;
  try {
    hostDaOrigem = new URL(origem).host;
  } catch {
    throw new AppError(403, 'ORIGEM_NAO_PERMITIDA', 'Origem da requisição inválida.');
  }
  if (hostDaOrigem === req.get('host') || env.CORS_ORIGINS.includes(origem)) return next();
  throw new AppError(403, 'ORIGEM_NAO_PERMITIDA', 'Requisição bloqueada: origem não permitida.');
};
