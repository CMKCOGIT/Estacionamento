import { createHash } from 'node:crypto';
import { registrar } from '../../registro.js';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ErroApiPublica } from '../../http/erros.js';
import { janelaPorMinuto } from '../../http/middlewares/limitador.js';
import { publicoService } from './publico.service.js';

export const publicoRouter = Router();
/**
 * Limites da consulta do ticket. Muitos clientes chegam pelo MESMO IP
 * (operadora de celular com NAT, wi-fi do estacionamento): limitar todas as
 * consultas por IP derrubaria o app de quem só está acompanhando o ticket.
 *  - por IP, só as consultas que FALHAM (token inexistente): é o que faz quem
 *    tenta adivinhar links;
 *  - por ticket: o app consulta a cada 30 s, o limite cobre recargas;
 *  - por IP, um teto alto contra abuso.
 */
const falhasPorIp = janelaPorMinuto(env.LIMITE_TICKET_POR_MINUTO);
const consultasPorTicket = janelaPorMinuto(env.LIMITE_TICKET_POR_TOKEN_POR_MINUTO);
const consultasPorIp = janelaPorMinuto(env.LIMITE_TICKET_TETO_POR_IP_POR_MINUTO);
export const limitadorTicket = {
  limpar() {
    falhasPorIp.limpar();
    consultasPorTicket.limpar();
    consultasPorIp.limpar();
  },
};
const MUITAS = { erro: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas consultas. Aguarde um minuto.' } };

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
publicoRouter.get('/ticket', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Authorization');
  const ip = req.ip ?? 'desconhecido';
  const autorizacao = req.get('authorization') ?? '';
  const chaveTicket = createHash('sha256').update(autorizacao).digest('base64url');
  const recusa =
    (falhasPorIp.excedido(ip) && falhasPorIp.consumir(ip)) ||
    consultasPorIp.consumir(ip) ||
    consultasPorTicket.consumir(chaveTicket);
  if (recusa) {
    // Registra só a primeira recusa de cada janela (não enche o registro num ataque)
    if (recusa.primeira)
      void registrar(req, {
        nivel: 'warn',
        tipo: 'limite.excedido',
        status: 429,
        detalhes: { rota: '/v1/ticket' },
      });
    res.set('Retry-After', String(recusa.segundos)).status(429).json(MUITAS);
    return;
  }
  try {
    res.json(await publicoService.ticket(autorizacao || undefined));
  } catch (e) {
    if (e instanceof ErroApiPublica && e.status === 404) falhasPorIp.consumir(ip);
    throw e;
  }
});
