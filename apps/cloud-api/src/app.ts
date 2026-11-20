import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { pool } from './db/pool.js';
import { ErroApiPublica } from './http/erros.js';
import { exigirHttps } from './http/middlewares/https.js';
import { publicoRouter } from './modules/publico/publico.routes.js';

/**
 * API externa: SÓ a API pública do PWA (`/v1`), somente leitura.
 * Não existe nenhuma rota administrativa aqui — o painel e suas funções
 * ficam apenas no servidor local do estacionamento.
 */
export function criarApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.CONFIAR_PROXY);
  app.use(exigirHttps(env.FORCAR_HTTPS));
  app.use(
    helmet({
      // API JSON: nada de scripts, frames ou recursos
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: env.FORCAR_HTTPS ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(pinoHttp({ logger, autoLogging: env.NODE_ENV !== 'test' }));

  // CORS: só o endereço do PWA, só leitura, só o cabeçalho Authorization
  app.use((req, res, next) => {
    const origem = req.get('origin');
    if (origem && env.PWA_ORIGENS.includes(origem)) {
      res.set('Access-Control-Allow-Origin', origem);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.status(origem && env.PWA_ORIGENS.includes(origem) ? 204 : 403).end();
      return;
    }
    // Só leitura: qualquer outro método é recusado
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res
        .status(405)
        .set('Allow', 'GET')
        .json({ erro: { codigo: 'REQUISICAO_INVALIDA', mensagem: 'Somente leitura.' } });
      return;
    }
    next();
  });

  app.get('/saude', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'indisponivel' });
    }
  });
  app.use('/v1', publicoRouter);

  app.use((_req, res) => {
    res.status(404).json({ erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado.' } });
  });
  const tratar: ErrorRequestHandler = (erro, req, res, _next) => {
    if (erro instanceof ErroApiPublica) {
      res.status(erro.status).json({ erro: { codigo: erro.codigo, mensagem: erro.message } });
      return;
    }
    req.log?.error({ err: erro }, 'Erro na API pública');
    res.status(503).json({
      erro: {
        codigo: 'INDISPONIVEL',
        mensagem: 'Serviço indisponível no momento. Tente de novo em instantes.',
      },
    });
  };
  app.use(tratar);
  return app;
}
