import { Router } from 'express';
import { exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { monitoramentoService } from '../../monitoramento/monitoramento.service.js';

/** Painel de monitoramento técnico (permissão sistema.monitorar). */
export const monitoramentoRouter = Router();

monitoramentoRouter.get('/', exigirPermissao('sistema.monitorar'), async (req, res) => {
  // "Verificar agora": refaz as verificações de rede em vez de usar o cache de 15 s
  if (req.query.forcar === '1') monitoramentoService.limparCache();
  res.set('Cache-Control', 'no-store').json(await monitoramentoService.painel());
});
