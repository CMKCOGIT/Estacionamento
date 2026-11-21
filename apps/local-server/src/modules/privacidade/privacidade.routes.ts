import { Router, type Request } from 'express';
import { z } from 'zod';
import { TIPOS_SOLICITACAO_LGPD, type TipoSolicitacaoLgpd } from '@estacionamento/shared';
import { contextoAuditoria, exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { privacidadeService as servico, type Ator } from './privacidade.service.js';

/**
 * LGPD: atendimento aos titulares (permissão lgpd.atender, só administradores
 * por padrão). Toda consulta, exportação e anonimização fica no histórico.
 */
export const privacidadeRouter = Router();
const atender = exigirPermissao('lgpd.atender');
const gerenciar = exigirPermissao('config.gerenciar');

const ator = (req: Request, motivo?: string | null): Ator => ({
  usuarioId: req.auth!.id,
  contexto: contextoAuditoria(req, motivo),
  ip: req.ip ?? null,
});
const placa = z
  .string()
  .trim()
  .min(4, 'Informe a placa')
  .max(12)
  .regex(/^[A-Za-z0-9-]+$/, 'Placa inválida');
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

privacidadeRouter.get('/titular', atender, async (req, res) => {
  const { placa: p } = z.object({ placa }).parse(req.query);
  res.set('Cache-Control', 'no-store').json(await servico.relatorioTitular(ator(req), p));
});

/** Portabilidade (art. 18, V): os dados do titular em JSON, para baixar e entregar. */
privacidadeRouter.get('/titular/exportar', atender, async (req, res) => {
  const { placa: p } = z.object({ placa }).parse(req.query);
  const r = await servico.relatorioTitular(ator(req), p);
  res
    .set('Cache-Control', 'no-store')
    .set(
      'Content-Disposition',
      `attachment; filename="dados-titular-${new Date().toISOString().slice(0, 10)}.json"`,
    )
    .type('application/json')
    .send(JSON.stringify(r, null, 2));
});

privacidadeRouter.post('/titular/anonimizar', atender, async (req, res) => {
  const d = z
    .object({
      placa,
      motivo: z.string().trim().min(5, 'Informe o motivo (ex.: protocolo da solicitação)').max(255),
      confirmacao: z.literal(true, { message: 'Confirme que a anonimização não pode ser desfeita' }),
    })
    .parse(req.body);
  res.json(await servico.anonimizarPlaca(ator(req, d.motivo), d.placa, d.motivo));
});

privacidadeRouter.get('/solicitacoes', atender, async (_req, res) => {
  res.set('Cache-Control', 'no-store').json({ itens: await servico.listarSolicitacoes() });
});

privacidadeRouter.post('/solicitacoes', atender, async (req, res) => {
  const d = z
    .object({
      tipo: z.enum(Object.keys(TIPOS_SOLICITACAO_LGPD) as [TipoSolicitacaoLgpd, ...TipoSolicitacaoLgpd[]]),
      titularNome: textoOpcional(120),
      titularContato: textoOpcional(160),
      placa: placa.nullish(),
      descricao: textoOpcional(1000),
    })
    .parse(req.body);
  res.status(201).json(await servico.registrarSolicitacao(ator(req), d));
});

privacidadeRouter.patch('/solicitacoes/:id', atender, async (req, res) => {
  const { id } = z.object({ id: z.string().regex(/^[0-9A-Z]{26}$/) }).parse(req.params);
  const d = z
    .object({
      status: z.enum(['ABERTA', 'EM_ANDAMENTO', 'ATENDIDA', 'INDEFERIDA']),
      resposta: textoOpcional(2000),
    })
    .parse(req.body);
  res.json(await servico.atualizarSolicitacao(ator(req), id, d));
});

privacidadeRouter.get('/retencao', atender, async (_req, res) => {
  res.json({ politica: await servico.politicaRetencao(), ultimaExecucao: await servico.ultimaRetencao() });
});

privacidadeRouter.put('/retencao', gerenciar, async (req, res) => {
  const p = z
    .object({
      placasMeses: z.number().int().min(1).max(120),
      acessosPainelDias: z.number().int().min(7).max(3650),
      historicoMeses: z.number().int().min(6).max(120),
      solicitacoesMeses: z.number().int().min(1).max(60),
    })
    .parse(req.body);
  res.json({ politica: await servico.definirPoliticaRetencao(ator(req, 'política de retenção'), p) });
});

privacidadeRouter.post('/retencao/executar', gerenciar, async (req, res) => {
  res.json(await servico.executarRetencao(req.auth!.id));
});

privacidadeRouter.get('/encarregado', atender, async (_req, res) => {
  res.json(await servico.encarregado());
});

privacidadeRouter.put('/encarregado', gerenciar, async (req, res) => {
  const e = z.object({ nome: textoOpcional(120), contato: textoOpcional(160) }).parse(req.body);
  res.json(await servico.definirEncarregado(ator(req, 'encarregado de dados'), e));
});
