import { Router } from 'express';
import { z } from 'zod';
import { exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { relatoriosService } from './relatorios.service.js';

export const relatoriosRouter = Router();

/** Relatórios financeiros: quem faz relatório financeiro ou supervisiona caixas. */
const financeiro = exigirPermissao('relatorio.financeiro', 'caixa.supervisionar');
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');
const ulidSchema = z.string().regex(/^[0-9A-Z]{26}$/, 'Identificador inválido');
const periodo = z.object({ de: data, ate: data });

relatoriosRouter.use(financeiro, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

relatoriosRouter.get('/faturamento', async (req, res) => {
  const q = periodo.extend({ agrupar: z.enum(['DIA', 'SEMANA', 'MES']).default('DIA') }).parse(req.query);
  res.json(await relatoriosService.faturamento(q.de, q.ate, q.agrupar));
});

relatoriosRouter.get('/formas', async (req, res) => {
  const q = periodo.parse(req.query);
  res.json(await relatoriosService.formas(q.de, q.ate));
});

relatoriosRouter.get('/pendentes', async (_req, res) => {
  res.json(await relatoriosService.pendentes());
});

relatoriosRouter.get('/fechamentos', async (req, res) => {
  const q = periodo.parse(req.query);
  res.json(await relatoriosService.fechamentos(q.de, q.ate));
});

/** Detalhe: ?movimentacaoId=... ou ?pagamentoId=... */
relatoriosRouter.get('/detalhe', async (req, res) => {
  const q = z
    .object({ movimentacaoId: ulidSchema.optional(), pagamentoId: ulidSchema.optional() })
    .refine((x) => !!x.movimentacaoId !== !!x.pagamentoId, 'Informe a movimentação ou o pagamento')
    .parse(req.query);
  res.json(await relatoriosService.detalhe(q));
});
