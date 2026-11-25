import { Router } from 'express';
import { exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { registrarAtividade } from '../../db/atividades.js';
import { obterSiteAtual } from '../../config/site.js';
import {
  pedirConferencia,
  pedirRessincronizacao,
  reenviarPendentes,
  registrosNaoSincronizados,
  statusSync,
} from '../../sync/index.js';

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

syncRouter.post('/conferir', exigirPermissao('config.gerenciar'), async (req, res) => {
  await pedirConferencia();
  const site = await obterSiteAtual();
  await registrarAtividade({
    acao: 'sync.conferir',
    siteId: site.id,
    usuarioId: req.auth!.id,
    entidade: 'sync_estado',
    entidadeId: site.id,
    ip: req.ip ?? null,
  });
  res.json(await statusSync());
});

/** Registros ainda não enviados à nuvem (pendentes e recusados). */
syncRouter.get('/pendentes', exigirPermissao('sync.ver', 'sistema.monitorar'), async (_req, res) => {
  const site = await obterSiteAtual();
  res.set('Cache-Control', 'no-store').json({ itens: await registrosNaoSincronizados(site.id) });
});

/** Reenviar agora: tira a espera dos pendentes e devolve os recusados para a fila. */
syncRouter.post('/reenviar', exigirPermissao('sync.gerenciar', 'config.gerenciar'), async (req, res) => {
  const site = await obterSiteAtual();
  const r = await reenviarPendentes(site.id);
  await registrarAtividade({
    acao: 'sync.reenviar',
    siteId: site.id,
    usuarioId: req.auth!.id,
    entidade: 'sync_outbox',
    entidadeId: site.id,
    dados: r,
    ip: req.ip ?? null,
  });
  res.json({ ...r, status: await statusSync() });
});
