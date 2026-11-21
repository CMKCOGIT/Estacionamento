import type { RequestHandler } from 'express';
import type { ErroApi } from '@estacionamento/shared';
import { env } from '../../config/env.js';
import { contextoRequisicao, type EstadoRequisicao } from '../contexto-requisicao.js';

/** Rotas que demoram por natureza (backup e teste de restauração). */
const SEM_LIMITE = [/^\/api\/v1\/backups(\/|$)/];

/**
 * Se o banco travar, a requisição não pode ficar pendurada: a tela recebe 503
 * com uma mensagem clara. As escritas já foram desfeitas pelo limite da
 * transação (DB_TRANSACAO_LIMITE_MS, menor que este).
 */
export const limiteDeTempo: RequestHandler = (req, res, next) => {
  if (SEM_LIMITE.some((r) => r.test(req.originalUrl))) return next();
  const estado: EstadoRequisicao = { expirada: false };
  const t = setTimeout(() => {
    if (res.headersSent) return;
    estado.expirada = true; // o que esta requisição ainda tentar gravar será recusado
    req.log?.warn({ limiteMs: env.REQUISICAO_LIMITE_MS }, 'Requisição sem resposta no tempo limite');
    const corpo: ErroApi = {
      erro: {
        codigo: 'BANCO_INDISPONIVEL',
        mensagem: 'O servidor não conseguiu responder a tempo (banco de dados sem resposta?). Tente de novo.',
        requestId: String(req.id ?? ''),
      },
    };
    res.status(503).json(corpo);
  }, env.REQUISICAO_LIMITE_MS);
  res.on('close', () => clearTimeout(t));
  res.on('finish', () => clearTimeout(t));
  contextoRequisicao.run(estado, next);
};
