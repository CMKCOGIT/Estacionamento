import { Router } from 'express';
import { exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { monitoramentoService } from '../../monitoramento/monitoramento.service.js';

/** Painel de monitoramento técnico (permissão sistema.monitorar). */
export const monitoramentoRouter = Router();

monitoramentoRouter.get('/', exigirPermissao('sistema.monitorar'), async (_req, res) => {
  res.set('Cache-Control', 'no-store').json(await monitoramentoService.painel());
});
