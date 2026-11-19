import { Router } from 'express';
import { dashboardService } from './dashboard.service.js';

/**
 * GET /dashboard — indicadores do painel (dados reais do banco).
 * Qualquer usuário logado acessa; cada seção só vem preenchida para quem
 * tem permissão (operação, financeiro, sincronização).
 */
export const dashboardRouter = Router();

dashboardRouter.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await dashboardService.obter(req.auth!));
});
