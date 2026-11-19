import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import type { AtividadeRegistrada, PaginaAtividades } from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import { pool } from '../../db/pool.js';
import { exigirPermissao } from '../../http/middlewares/autenticacao.js';

/** Consulta do histórico de atividades (tabela historico_atividades). */
export const atividadesRouter = Router();

const filtro = z.object({
  usuarioId: z
    .string()
    .regex(/^[0-9A-Z]{26}$/)
    .optional(),
  /** Prefixo da ação: "tarifa", "sessao", "usuario", "auth"... */
  modulo: z
    .string()
    .regex(/^[a-z_]+$/)
    .max(30)
    .optional(),
  acao: z
    .string()
    .regex(/^[a-z_]+\.[a-z_]+$/)
    .max(60)
    .optional(),
  entidadeId: z.string().max(64).optional(),
  de: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  ate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  antesDe: z.string().regex(/^\d+$/).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

/** Converte JSON vindo do driver (objeto ou string). */
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? null));

atividadesRouter.get('/', exigirPermissao('auditoria.ver'), async (req, res) => {
  const f = filtro.parse(req.query);
  const site = await obterSiteAtual();
  // Eventos sem site (ex.: alterações em usuários globais) também pertencem a este servidor.
  const where = ['(h.site_id = ? OR h.site_id IS NULL)'];
  const params: unknown[] = [site.id];
  const condicao = (sql: string, valor: unknown) => {
    where.push(sql);
    params.push(valor);
  };
  if (f.usuarioId) condicao('h.usuario_id = ?', f.usuarioId);
  if (f.acao) condicao('h.acao = ?', f.acao);
  else if (f.modulo) condicao('h.acao LIKE ?', `${f.modulo}.%`);
  if (f.entidadeId) condicao('h.entidade_id LIKE ?', `%${f.entidadeId}%`);
  // Datas no fuso do estacionamento (America/Sao_Paulo = UTC-3, sem horário de verão desde 2019)
  if (f.de) condicao('h.criado_em >= ? + INTERVAL 3 HOUR', f.de);
  if (f.ate) condicao('h.criado_em < ? + INTERVAL 1 DAY + INTERVAL 3 HOUR', f.ate);
  if (f.antesDe) condicao('h.id < ?', f.antesDe);

  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT h.id, h.criado_em, h.acao, h.entidade, h.entidade_id, h.dados_anteriores, h.dados_novos,
            h.motivo, h.origem, h.ip, h.usuario_id, u.login, COALESCE(fu.nome, u.login) AS nome
       FROM historico_atividades h
       LEFT JOIN usuarios u      ON u.id = h.usuario_id
       LEFT JOIN funcionarios fu ON fu.usuario_id = u.id
      WHERE ${where.join(' AND ')}
      ORDER BY h.id DESC
      LIMIT ?`,
    [...params, f.limite + 1],
  );

  const temMais = linhas.length > f.limite;
  const itens: AtividadeRegistrada[] = linhas.slice(0, f.limite).map((l) => ({
    id: String(l.id),
    criadoEm: (l.criado_em as Date).toISOString(),
    usuario: l.usuario_id ? { id: l.usuario_id, login: l.login ?? '?', nome: l.nome ?? '?' } : null,
    acao: l.acao,
    entidade: l.entidade ?? null,
    entidadeId: l.entidade_id ?? null,
    dadosAnteriores: json(l.dados_anteriores),
    dadosNovos: json(l.dados_novos),
    motivo: l.motivo ?? null,
    origem: l.origem,
    ip: l.ip ?? null,
  }));
  res.json({ itens, proximaPagina: temMais ? (itens.at(-1)?.id ?? null) : null } satisfies PaginaAtividades);
});
