import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { pool } from './db/pool.js';
import { ErroApiPublica } from './http/erros.js';
import { exigirHttps } from './http/middlewares/https.js';
import { ZodError } from 'zod';
import { modulos } from './modules/index.js';
import { registrar } from './registro.js';

/**
 * API externa:
 *  - `/v1`: consulta do cliente (PWA). Somente leitura.
 *  - `/sync/v1`: recebe os dados do servidor local (autenticação HMAC).
 * Não existe nenhuma rota administrativa, operacional ou financeira aqui:
 * o painel e suas funções ficam apenas no servidor local do estacionamento.
 * Rotas e dados públicos: docs/API-EXTERNA.md e openapi.yaml.
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
  // Toda requisição tem um id (X-Request-Id), que aparece no log e no registro
  app.use(
    pinoHttp({
      logger,
      autoLogging: env.NODE_ENV !== 'test',
      genReqId: (req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, erro) =>
        erro || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      // Só método, rota (sem query string) e cabeçalhos não sensíveis
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
      },
    }),
  );

  // CORS: só o endereço do PWA, só leitura, só o cabeçalho Authorization
  const somenteLeituraPublica: RequestHandler = (req, res, next) => {
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
  };

  app.get('/saude', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'indisponivel' });
    }
  });
  for (const m of modulos) {
    if (m.acesso === 'PUBLICO') app.use(m.caminho, somenteLeituraPublica, m.router);
    else app.use(m.caminho, m.router);
  }
  // Fora dos módulos: só leitura também (POST/PUT/DELETE em qualquer outra rota = 405)
  app.use(somenteLeituraPublica);

  app.use((_req, res) => {
    res.status(404).json({ erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado.' } });
  });
  const tratar: ErrorRequestHandler = (erro, req, res, _next) => {
    if (erro instanceof ErroApiPublica) {
      res.status(erro.status).json({ erro: { codigo: erro.codigo, mensagem: erro.message } });
      return;
    }
    const tamanho = (erro as { type?: string }).type === 'entity.too.large';
    if (erro instanceof ZodError || tamanho) {
      const detalhes =
        erro instanceof ZodError
          ? erro.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`)
          : ['corpo grande demais'];
      void registrar(req, {
        nivel: 'warn',
        tipo: 'requisicao.invalida',
        status: tamanho ? 413 : 400,
        integracaoId: req.integracao?.id,
        detalhes: { detalhes },
      });
      res.status(tamanho ? 413 : 400).json({
        erro: { codigo: 'REQUISICAO_INVALIDA', mensagem: 'Dados inválidos.', detalhes },
      });
      return;
    }
    void registrar(req, {
      nivel: 'error',
      tipo: 'erro.interno',
      status: 503,
      integracaoId: req.integracao?.id,
      detalhes: { erro: erro instanceof Error ? erro.message.slice(0, 300) : String(erro).slice(0, 300) },
    });
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
