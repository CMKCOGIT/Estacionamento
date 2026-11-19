import { Router } from 'express';
import { z } from 'zod';
import type { Lista, FormaPagamento } from '@estacionamento/shared';
import { formasPagamentoService } from './formas-pagamento.service.js';

/**
 * Módulo de exemplo do padrão usado em todos os módulos:
 *   routes (HTTP + validação) → service (regras) → repository (SQL)
 */
export const formasPagamentoRouter = Router();

const consultaListagem = z.object({
  ativas: z.enum(['true', 'false']).default('true'),
});

const parametroCodigo = z.object({
  codigo: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Código inválido')
    .transform((c) => c.toUpperCase()),
});

formasPagamentoRouter.get('/', async (req, res) => {
  const { ativas } = consultaListagem.parse(req.query);
  const itens = await formasPagamentoService.listar(ativas === 'true');
  res.json({ itens } satisfies Lista<FormaPagamento>);
});

formasPagamentoRouter.get('/:codigo', async (req, res) => {
  const { codigo } = parametroCodigo.parse(req.params);
  res.json(await formasPagamentoService.obter(codigo));
});
