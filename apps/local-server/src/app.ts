import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { ulid } from 'ulid';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { rotaNaoEncontrada, tratarErros } from './http/middlewares/tratar-erros.js';
import { criarRotasApi } from './http/rotas.js';

const ID_REQUISICAO_VALIDO = /^[A-Za-z0-9-]{8,64}$/;

/** Pasta do painel compilado (apps/admin-web/dist), relativa a src/ ou dist/. */
function pastaAdminWeb(): string {
  return env.ADMIN_WEB_DIST ?? resolve(fileURLToPath(new URL('.', import.meta.url)), '../../admin-web/dist');
}

/**
 * Monta a aplicação Express sem abrir porta (facilita os testes).
 * Ordem: segurança → log → corpo JSON → API → painel → erros.
 */
export function criarApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet());
  if (env.CORS_ORIGINS.length > 0) app.use(cors({ origin: env.CORS_ORIGINS }));

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const recebido = req.headers['x-request-id'];
        const id = typeof recebido === 'string' && ID_REQUISICAO_VALIDO.test(recebido) ? recebido : ulid();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/v1/health/live' },
      customLogLevel: (_req, res, erro) =>
        erro || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );

  app.use(express.json({ limit: '100kb' }));

  app.use('/api/v1', criarRotasApi());
  app.use('/api', rotaNaoEncontrada); // /api sem versão ou versão inexistente

  // Painel administrativo (build do Vite) + fallback para rotas do React.
  const pasta = pastaAdminWeb();
  if (env.SERVE_ADMIN_WEB && existsSync(pasta)) {
    app.use(express.static(pasta, { index: 'index.html', maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || !req.accepts('html')) return next();
      res.sendFile(resolve(pasta, 'index.html'));
    });
  }

  app.use(rotaNaoEncontrada);
  app.use(tratarErros);
  return app;
}
