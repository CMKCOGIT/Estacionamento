import express, { Router } from 'express';
import { env } from '../../config/env.js';
import { autenticarIntegracao } from '../../http/middlewares/integracao.js';
import { limitarPorIp } from '../../http/middlewares/limitador.js';
import { registrar } from '../../registro.js';
import { syncService } from './sync.service.js';

/**
 * Sincronização servidor local → nuvem (só integrações autenticadas por HMAC).
 * O PWA e os clientes NÃO acessam estas rotas: não há CORS para elas, e
 * sem a credencial do estacionamento a resposta é sempre 401.
 */
export const syncRouter = Router();
export const limitadorSync = limitarPorIp(env.LIMITE_SYNC_POR_MINUTO, (req) => {
  void registrar(req, { nivel: 'warn', tipo: 'limite.excedido', status: 429, detalhes: { rota: 'sync' } });
});

/** Guarda o corpo bruto (a assinatura é conferida sobre os bytes exatos) e depois lê o JSON. */
const corpo = (limite: string) => [
  express.raw({ type: '*/*', limit: limite }),
  (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.corpoBruto = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    next();
  },
];
const lerJson = (req: express.Request): unknown => {
  try {
    return req.corpoBruto?.length ? JSON.parse(req.corpoBruto.toString('utf8')) : {};
  } catch {
    return Symbol('json inválido'); // o schema recusa com 400
  }
};

/** Primeiro envio de uma credencial sem estacionamento: registra a que estacionamento ela ficou presa. */
const vinculado = (req: express.Request) => () =>
  registrar(req, {
    tipo: 'sync.vinculado',
    integracaoId: req.integracao!.id,
    siteId: req.integracao!.siteId,
  });

syncRouter.use(limitadorSync);

/** Lote de eventos (até 100). Lote vazio = sinal de vida do estacionamento. */
syncRouter.post('/push', ...corpo('512kb'), autenticarIntegracao('sync:escrever'), async (req, res) => {
  const integracao = req.integracao!;
  const r = await syncService.push(integracao, lerJson(req), vinculado(req));
  const total = r.aplicados + r.repetidos + r.superados + r.rejeitados.length;
  if (total > 0)
    await registrar(req, {
      tipo: 'sync.lote',
      status: 200,
      integracaoId: integracao.id,
      siteId: integracao.siteId,
      detalhes: {
        aplicados: r.aplicados,
        repetidos: r.repetidos,
        superados: r.superados,
        rejeitados: r.rejeitados.length,
        ultimoSeq: r.ultimoSeq,
      },
    });
  if (r.rejeitados.length)
    await registrar(req, {
      nivel: 'warn',
      tipo: 'sync.rejeitado',
      status: 200,
      integracaoId: integracao.id,
      siteId: integracao.siteId,
      detalhes: { rejeitados: r.rejeitados.slice(0, 20) },
    });
  res.json(r);
});

/** Ressincronização completa (carga do estado atual), em partes. */
syncRouter.post('/snapshot', ...corpo('2mb'), autenticarIntegracao('sync:escrever'), async (req, res) => {
  const integracao = req.integracao!;
  const { tickets, ...resposta } = await syncService.snapshot(integracao, lerJson(req), vinculado(req));
  await registrar(req, {
    tipo: 'sync.snapshot',
    status: 200,
    integracaoId: integracao.id,
    siteId: integracao.siteId,
    detalhes: {
      parte: resposta.parte,
      concluido: resposta.concluido,
      tickets,
      removidos: resposta.removidos,
    },
  });
  res.json(resposta);
});

/** Conferência entre os bancos: o que está diferente, faltando ou sobrando na nuvem. */
syncRouter.post('/conferir', ...corpo('2mb'), autenticarIntegracao('sync:ler'), async (req, res) => {
  const integracao = req.integracao!;
  const r = await syncService.conferir(integracao, lerJson(req));
  await registrar(req, {
    nivel: r.divergentes.length || r.sobrando.length ? 'warn' : 'info',
    tipo: 'sync.conferencia',
    status: 200,
    integracaoId: integracao.id,
    siteId: integracao.siteId,
    detalhes: { conferidos: r.conferidos, divergentes: r.divergentes.length, sobrando: r.sobrando.length },
  });
  res.json(r);
});

/** Último seq aplicado e último contato (o servidor local confere ao iniciar). */
syncRouter.get('/status', ...corpo('1kb'), autenticarIntegracao('sync:ler'), async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await syncService.status(req.integracao!));
});
