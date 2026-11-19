import { Router } from 'express';
import type { StatusSistema } from '@estacionamento/shared';
import { appInfo } from '../../config/app-info.js';
import { env } from '../../config/env.js';
import { verificarBanco } from '../../db/saude.js';

export const healthRouter = Router();

/** Liveness: o processo está de pé (não consulta o banco). */
healthRouter.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

/** Status completo: API + banco. 503 se o banco estiver fora. */
healthRouter.get('/', async (_req, res) => {
  const banco = await verificarBanco();
  const corpo: StatusSistema = {
    status: banco.ok ? 'ok' : 'degradado',
    servico: appInfo.nome,
    versao: appInfo.versao,
    ambiente: env.NODE_ENV,
    iniciadoEm: appInfo.iniciadoEm.toISOString(),
    uptimeSegundos: Math.round(process.uptime()),
    banco,
  };
  res.status(banco.ok ? 200 : 503).json(corpo);
});
