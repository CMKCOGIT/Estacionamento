import { Router, type Request } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import { z } from 'zod';
import { obterSiteAtual } from '../../config/site.js';
import { comTransacao } from '../../db/transacao.js';
import { erros } from '../../http/erros.js';
import { contextoAuditoria, exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { caixaService } from '../sessoes/caixa.service.js';
import { sessoesService } from '../sessoes/sessoes.service.js';
import { financeiroService } from './financeiro.service.js';

export const financeiroRouter = Router();

const ulidSchema = z.string().regex(/^[0-9A-Z]{26}$/, 'Identificador inválido');
const idDe = (req: Request) => z.object({ id: ulidSchema }).parse(req.params).id;
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD');
const centavos = z.number().int().min(0).max(10_000_000);
const paginacao = {
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(200).default(50),
};

/** Visão de todos os caixas e pagamentos (supervisão e relatórios). */
const supervisao = exigirPermissao('relatorio.financeiro', 'caixa.supervisionar');

financeiroRouter.get('/resumo', supervisao, async (req, res) => {
  const q = z.object({ data: data.optional() }).parse(req.query);
  res.set('Cache-Control', 'no-store');
  res.json(await financeiroService.resumoDoDia(q.data));
});

financeiroRouter.get('/pagamentos', supervisao, async (req, res) => {
  const q = z
    .object({
      de: data.optional(),
      ate: data.optional(),
      forma: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]*$/)
        .optional(),
      status: z.enum(['CONFIRMADO', 'ESTORNADO']).optional(),
      caixaId: ulidSchema.optional(),
      sessaoId: ulidSchema.optional(),
      busca: z.string().trim().max(20).optional(),
      ...paginacao,
    })
    .parse(req.query);
  const { pagina, limite, ...f } = q;
  res.set('Cache-Control', 'no-store');
  res.json(await financeiroService.pagamentos(f, { pagina, limite }));
});

financeiroRouter.get(
  '/pendentes',
  exigirPermissao('sessao.saida', 'pagamento.registrar', 'relatorio.financeiro', 'caixa.supervisionar'),
  async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await financeiroService.pendentes());
  },
);

financeiroRouter.get('/movimentacoes', supervisao, async (req, res) => {
  const q = z
    .object({
      de: data.optional(),
      ate: data.optional(),
      caixaId: ulidSchema.optional(),
      tipo: z.enum(['ABERTURA', 'SUPRIMENTO', 'SANGRIA', 'RECEBIMENTO', 'ESTORNO', 'AJUSTE']).optional(),
      forma: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]*$/)
        .optional(),
      ...paginacao,
    })
    .parse(req.query);
  const { pagina, limite, ...f } = q;
  res.set('Cache-Control', 'no-store');
  res.json(await financeiroService.movimentacoes(f, { pagina, limite }));
});

const veCaixas = exigirPermissao('caixa.operar', 'caixa.supervisionar', 'relatorio.financeiro');

financeiroRouter.get('/caixas', veCaixas, async (req, res) => {
  const q = z.object({ de: data.optional(), ate: data.optional() }).parse(req.query);
  res.set('Cache-Control', 'no-store');
  res.json({ itens: await financeiroService.caixas(req.auth!, q) });
});

financeiroRouter.get('/caixas/:id', veCaixas, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await financeiroService.caixa(req.auth!, idDe(req)));
});

/** Supervisor fecha o caixa de outro operador (ex.: esqueceu aberto). */
financeiroRouter.post('/caixas/:id/fechar', exigirPermissao('caixa.supervisionar'), async (req, res) => {
  const d = z
    .object({ saldoContadoCentavos: centavos, observacao: z.string().trim().max(500).nullish() })
    .parse(req.body);
  res.json(
    await caixaService.fecharCaixa({
      caixaId: idDe(req),
      fechadoPor: req.auth!.id,
      contexto: contextoAuditoria(req, d.observacao || 'fechamento de caixa pelo supervisor'),
      ...d,
    }),
  );
});

financeiroRouter.post('/pagamentos/:id/estornar', exigirPermissao('pagamento.estornar'), async (req, res) => {
  const { motivo } = z
    .object({ motivo: z.string().trim().min(3, 'Informe o motivo').max(255) })
    .parse(req.body);
  res.json(
    await sessoesService.estornarPagamento(
      {
        auth: req.auth!,
        contexto: contextoAuditoria(req, motivo),
        origem: `${req.protocol}://${req.get('host')}`,
      },
      idDe(req),
      motivo,
    ),
  );
});

/**
 * Correção de um caixa JÁ FECHADO (ex.: dinheiro achado depois, erro de
 * contagem). Vira uma movimentação AJUSTE com motivo, de quem autorizou. O
 * fechamento original não muda: o painel mostra a diferença corrigida à parte.
 */
financeiroRouter.post('/caixas/:id/correcoes', exigirPermissao('caixa.supervisionar'), async (req, res) => {
  const d = z
    .object({
      direcao: z.enum(['ENTRADA', 'SAIDA'], { message: 'Escolha entrada ou saída' }),
      valorCentavos: z.number().int().min(1, 'Informe um valor maior que zero').max(100_000_00),
      formaCodigo: z.string().regex(/^[A-Z_]{2,20}$/),
      motivo: z.string().trim().min(5, 'Explique a correção (mínimo 5 caracteres)').max(255),
    })
    .parse(req.body);
  const caixaId = idDe(req);
  const site = await obterSiteAtual();
  await comTransacao(contextoAuditoria(req, d.motivo), async (c) => {
    const [[cx]] = await c.query<RowDataPacket[]>(
      'SELECT status FROM caixa_sessoes WHERE id = ? AND site_id = ? FOR UPDATE',
      [caixaId, site.id],
    );
    if (!cx) throw erros.naoEncontrado('Caixa não encontrado');
    if (cx.status !== 'FECHADO') {
      throw erros.regraDeNegocio('O caixa ainda está aberto: use sangria ou suprimento.');
    }
    const [[forma]] = await c.query<RowDataPacket[]>('SELECT codigo FROM formas_pagamento WHERE codigo = ?', [
      d.formaCodigo,
    ]);
    if (!forma) throw erros.requisicaoInvalida('Forma de pagamento inválida');
    await c.query(
      `INSERT INTO movimentacoes_financeiras
         (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, descricao, registrado_por, registrado_em)
       VALUES (?, ?, ?, 'AJUSTE', ?, ?, ?, ?, ?, NOW(3))`,
      [ulid(), site.id, caixaId, d.direcao, d.valorCentavos, d.formaCodigo, d.motivo, req.auth!.id],
    );
  });
  res.status(201).json(await financeiroService.caixa(req.auth!, caixaId));
});
