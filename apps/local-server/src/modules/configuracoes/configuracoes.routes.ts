import { Router } from 'express';
import { z } from 'zod';
import { HORAS_APOS_SAIDA_MAX } from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import { contextoAuditoria, exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { configuracoesService } from './configuracoes.service.js';

export const configuracoesRouter = Router();
const gerenciar = exigirPermissao('config.gerenciar');

configuracoesRouter.get('/acesso-cliente', gerenciar, async (_req, res) => {
  const site = await obterSiteAtual();
  res.json(await configuracoesService.politicaAcessoCliente(site.id));
});

const schemaPolitica = z.object({
  horasAposSaida: z
    .number({ message: 'Informe o número de horas' })
    .int('Use horas inteiras')
    .min(0, 'Mínimo: 0 (o acesso termina na saída)')
    .max(HORAS_APOS_SAIDA_MAX, `Máximo: ${HORAS_APOS_SAIDA_MAX} horas (7 dias)`),
});

configuracoesRouter.put('/acesso-cliente', gerenciar, async (req, res) => {
  const p = schemaPolitica.parse(req.body);
  res.json(
    await configuracoesService.definirPoliticaAcessoCliente(
      req.auth!.id,
      contextoAuditoria(req, 'política de acesso do cliente'),
      p,
    ),
  );
});
