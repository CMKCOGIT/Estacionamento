import { Router } from 'express';
import { z } from 'zod';
import { exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { relatoriosOperacionaisService as servico } from './relatorios-operacionais.service.js';

/** Relatórios administrativos da operação (permissão relatorio.operacional). */
export const relatoriosOperacionaisRouter = Router();

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');
const ulid = z.string().regex(/^[0-9A-Z]{26}$/, 'Identificador inválido');
const placa = z
  .string()
  .trim()
  .max(10)
  .regex(/^[A-Za-z0-9-]*$/, 'Placa inválida')
  .optional()
  .transform((v) => v || undefined);
const periodo = z.object({ de: data, ate: data });
const filtros = periodo.extend({
  placa,
  operadorId: ulid.optional(),
  situacao: z.enum(['ABERTA', 'ENCERRADA', 'CANCELADA']).optional(),
});

relatoriosOperacionaisRouter.use(exigirPermissao('relatorio.operacional'), (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

relatoriosOperacionaisRouter.get('/funcionarios', async (_req, res) => {
  res.json({ itens: await servico.funcionarios() });
});
relatoriosOperacionaisRouter.get('/movimento', async (req, res) => {
  res.json(await servico.movimento(filtros.parse(req.query)));
});
relatoriosOperacionaisRouter.get('/estacionados', async (req, res) => {
  res.json({
    itens: await servico.estacionados(z.object({ placa, operadorId: ulid.optional() }).parse(req.query)),
  });
});
relatoriosOperacionaisRouter.get('/placa', async (req, res) => {
  const q = z.object({ placa: z.string().trim().min(4, 'Informe a placa').max(10) }).parse(req.query);
  res.json(await servico.historicoPlaca(q.placa));
});
relatoriosOperacionaisRouter.get('/ocupacao', async (req, res) => {
  res.json(await servico.ocupacao(periodo.parse(req.query)));
});
relatoriosOperacionaisRouter.get('/bloqueios', async (req, res) => {
  res.json(await servico.bloqueios(periodo.extend({ operadorId: ulid.optional() }).parse(req.query)));
});
relatoriosOperacionaisRouter.get('/funcionarios/movimento', async (req, res) => {
  res.json({
    itens: await servico.porFuncionario(periodo.extend({ operadorId: ulid.optional() }).parse(req.query)),
  });
});
relatoriosOperacionaisRouter.get('/indicadores', async (req, res) => {
  res.json(await servico.indicadores(periodo.parse(req.query)));
});
