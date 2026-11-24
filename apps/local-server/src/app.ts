import { limiteDeTempo } from './http/middlewares/limite-tempo.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { ulid } from 'ulid';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { verificarOrigem } from './http/middlewares/origem.js';
import { rotaNaoEncontrada, tratarErros } from './http/middlewares/tratar-erros.js';
import { criarRotasApi } from './http/rotas.js';

const ID_REQUISICAO_VALIDO = /^[A-Za-z0-9-]{8,64}$/;

/** Pasta do painel compilado (apps/admin-web/dist), relativa a src/ ou dist/. */
function pastaAdminWeb(): string {
  return env.ADMIN_WEB_DIST ?? resolve(fileURLToPath(new URL('.', import.meta.url)), '../../admin-web/dist');
}

/**
 * Monta a aplicação Express sem abrir porta (facilita os testes).
 * Ordem: segurança → log → corpo JSON/cookies → origem → API → painel → erros.
 */
export function criarApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  // Na rede local o painel é acessado por HTTP (http://<ip>:8080). Os padrões
  // do helmet para HTTPS (upgrade-insecure-requests e HSTS) fariam o navegador
  // de OUTROS computadores buscar os arquivos do painel via https:// — e a
  // página ficaria em branco. Só são ativados quando o acesso é por HTTPS.
  const usaHttps = env.HTTPS || env.COOKIE_SECURE;
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: usaHttps ? [] : null } },
      strictTransportSecurity: usaHttps,
    }),
  );
  if (env.CORS_ORIGINS.length > 0) app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));

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
      // Só método e caminho (sem query string: ?termo= pode ser uma placa) e o IP de origem
      serializers: {
        req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
          remoteAddress: req.remoteAddress,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', verificarOrigem);
  app.use('/api', limiteDeTempo);

  app.use('/api/v1', criarRotasApi());
  app.use('/api', rotaNaoEncontrada); // /api sem versão ou versão inexistente

  // Painel administrativo (build do Vite) + fallback para rotas do React.
  const pasta = pastaAdminWeb();
  if (env.SERVE_ADMIN_WEB && existsSync(pasta)) {
    // index.html nunca fica em cache: depois de atualizar, o navegador já
    // pega a versão nova. Os arquivos de assets/ têm o hash no nome e podem
    // ficar guardados à vontade.
    app.use(
      express.static(pasta, {
        index: 'index.html',
        setHeaders: (res, caminho) => {
          res.setHeader(
            'Cache-Control',
            /[\\/]assets[\\/]/.test(caminho) ? 'public, max-age=31536000, immutable' : 'no-cache',
          );
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || !req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(resolve(pasta, 'index.html'));
    });
  }

  app.use(rotaNaoEncontrada);
  app.use(tratarErros);
  return app;
}
