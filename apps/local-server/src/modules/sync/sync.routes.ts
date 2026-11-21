import { Router } from 'express';
import { exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { registrarAtividade } from '../../db/atividades.js';
import { obterSiteAtual } from '../../config/site.js';
import { pedirRessincronizacao, statusSync } from '../../sync/index.js';

/** Situação da sincronização com a nuvem (painel → Configurações). */
export const syncRouter = Router();

syncRouter.get('/status', exigirPermissao('sync.ver', 'config.gerenciar'), async (_req, res) => {
  res.json(await statusSync());
});

syncRouter.post('/ressincronizar', exigirPermissao('config.gerenciar'), async (req, res) => {
  await pedirRessincronizacao();
  const site = await obterSiteAtual();
  await registrarAtividade({
    acao: 'sync.ressincronizar',
    siteId: site.id,
    usuarioId: req.auth!.id,
    entidade: 'sync_estado',
    entidadeId: site.id,
    ip: req.ip ?? null,
  });
  res.json(await statusSync());
});
