import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ErroApiPublica } from '../../http/erros.js';
import { limitarPorIp } from '../../http/middlewares/limitador.js';
import { publicoService } from './publico.service.js';

export const publicoRouter = Router();
export const limitadorTicket = limitarPorIp(env.LIMITE_TICKET_POR_MINUTO);

const slug = (v: unknown) => {
  const r = z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(60)
    .safeParse(v);
  if (!r.success) throw new ErroApiPublica(404, 'NAO_ENCONTRADO', 'Estacionamento não encontrado.');
  return r.data;
};

// Disponibilidade e tarifas: públicas, podem ficar em cache por pouco tempo
publicoRouter.get('/sites/:slug/disponibilidade', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=15');
  res.json(await publicoService.disponibilidade(slug(req.params.slug)));
});

publicoRouter.get('/sites/:slug/tarifas', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await publicoService.tarifas(slug(req.params.slug)));
});

// Ticket: dado pessoal, nunca vai para cache de ninguém
publicoRouter.get('/ticket', limitadorTicket, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Authorization');
  res.json(await publicoService.ticket(req.get('authorization')));
});
