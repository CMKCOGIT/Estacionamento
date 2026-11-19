import { Router, type Request } from 'express';
import { z } from 'zod';
import { contextoAuditoria, exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { tarifasService, type Ator } from './tarifas.service.js';

export const tarifasRouter = Router();

const ver = exigirPermissao('tarifa.ver', 'tarifa.gerenciar', 'tarifa.publicar');
const gerenciar = exigirPermissao('tarifa.gerenciar');
const publicar = exigirPermissao('tarifa.publicar');

const ulidSchema = z.string().regex(/^[0-9A-Z]{26}$/, 'Identificador inválido');
const params = (req: Request) =>
  z.object({ id: ulidSchema, regraId: ulidSchema.optional() }).parse(req.params);
const ator = (req: Request, motivo?: string | null): Ator => ({
  usuarioId: req.auth!.id,
  contexto: contextoAuditoria(req, motivo),
});

const centavos = z.number().int().min(0).max(10_000_000);
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

const schemaRegra = z.object({
  categoriaId: ulidSchema,
  tipo: z.enum(['PADRAO', 'ESPECIAL']),
  nome: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((v) => v || null),
  aplicacao: z
    .enum(['AUTOMATICA', 'MANUAL'])
    .nullish()
    .transform((v) => v ?? null),
  diasSemana: z
    .number()
    .int()
    .min(0)
    .max(127)
    .nullish()
    .transform((v) => v ?? null),
  horaInicio: hora.nullish().transform((v) => v ?? null),
  horaFim: hora.nullish().transform((v) => v ?? null),
  ativo: z.boolean().default(true),
  toleranciaMin: z.number().int().min(0).max(240),
  primeiraHoraCentavos: centavos,
  horaAdicionalCentavos: centavos,
  fracaoMin: z.number().int().min(1).max(59).nullable(),
  fracaoCentavos: centavos.nullable(),
  carenciaMin: z.number().int().min(0).max(59).default(0),
  diariaMaximaCentavos: centavos.nullable(),
  diariaCentavos: centavos.nullable(),
  valorFixoCentavos: centavos.nullish().transform((v) => v ?? null),
});

tarifasRouter.get('/', ver, async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await tarifasService.painel());
});

tarifasRouter.get('/:id', ver, async (req, res) => {
  res.json(await tarifasService.obter(params(req).id));
});

/** Nova versão em rascunho (cópia da vigente ou de `baseId`). */
tarifasRouter.post('/', gerenciar, async (req, res) => {
  const d = z
    .object({ baseId: ulidSchema.nullish(), nome: z.string().trim().max(80).nullish() })
    .parse(req.body ?? {});
  res.status(201).json(await tarifasService.criarRascunho(ator(req, 'nova versão de tarifas'), d));
});

tarifasRouter.patch('/:id', gerenciar, async (req, res) => {
  const d = z
    .object({
      nome: z.string().trim().min(1, 'Informe o nome').max(80),
      descricao: z
        .string()
        .trim()
        .max(255)
        .nullish()
        .transform((v) => v || null),
    })
    .parse(req.body);
  res.json(await tarifasService.editarRascunho(ator(req), params(req).id, d));
});

tarifasRouter.delete('/:id', gerenciar, async (req, res) => {
  await tarifasService.descartarRascunho(ator(req, 'rascunho descartado'), params(req).id);
  res.status(204).end();
});

tarifasRouter.post('/:id/regras', gerenciar, async (req, res) => {
  res
    .status(201)
    .json(await tarifasService.salvarRegra(ator(req), params(req).id, null, schemaRegra.parse(req.body)));
});

tarifasRouter.put('/:id/regras/:regraId', gerenciar, async (req, res) => {
  const p = params(req);
  res.json(await tarifasService.salvarRegra(ator(req), p.id, p.regraId!, schemaRegra.parse(req.body)));
});

tarifasRouter.delete('/:id/regras/:regraId', gerenciar, async (req, res) => {
  const p = params(req);
  res.json(await tarifasService.removerRegra(ator(req), p.id, p.regraId!));
});

tarifasRouter.post('/:id/publicar', publicar, async (req, res) => {
  const { vigenteDesde } = z
    .object({ vigenteDesde: z.iso.datetime({ offset: true }).nullish() })
    .parse(req.body ?? {});
  res.json(
    await tarifasService.publicar(
      ator(req, 'publicação de tarifas'),
      params(req).id,
      vigenteDesde ? new Date(vigenteDesde) : null,
    ),
  );
});

tarifasRouter.post('/:id/arquivar', publicar, async (req, res) => {
  res.json(await tarifasService.arquivar(ator(req, 'tabela de tarifas arquivada'), params(req).id));
});
