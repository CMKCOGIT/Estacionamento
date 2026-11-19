import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Categoria, Lista } from '@estacionamento/shared';
import { contextoAuditoria, exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { vagasService, type Ator } from './vagas.service.js';

export const vagasRouter = Router();
export const categoriasRouter = Router();

const leitura = exigirPermissao(
  'vaga.gerenciar',
  'vaga.capacidade',
  'sessao.consultar',
  'sessao.entrada',
  'relatorio.operacional',
);
const gerenciar = exigirPermissao('vaga.gerenciar');
const capacidade = exigirPermissao('vaga.capacidade');

const ulidSchema = z.string().regex(/^[0-9A-Z]{26}$/, 'Identificador inválido');
const idDe = (req: Request) => z.object({ id: ulidSchema }).parse(req.params).id;
const ator = (req: Request, motivo?: string | null): Ator => ({
  usuarioId: req.auth!.id,
  contexto: contextoAuditoria(req, motivo),
});

const texto = (max: number) => z.string().trim().max(max).nullish();
const motivo = z.object({ motivo: z.string().trim().min(3, 'Informe o motivo').max(255) });

const schemaVaga = z.object({
  codigo: z.string().trim().min(1, 'Informe o código').max(20),
  setor: texto(40),
  categoriaId: ulidSchema,
  coberta: z.boolean().default(false),
  observacao: texto(255),
});

const schemaLote = z.object({
  prefixo: z.string().trim().max(15).default(''),
  inicio: z.number().int().min(0).max(99_999),
  quantidade: z.number().int().min(1).max(500),
  digitos: z.number().int().min(1).max(5).default(2),
  setor: texto(40),
  categoriaId: ulidSchema,
  coberta: z.boolean().default(false),
});

const filtro = z.object({
  categoriaId: ulidSchema.optional(),
  setor: z.string().max(40).optional(),
  estado: z.enum(['LIVRE', 'OCUPADA', 'BLOQUEADA', 'REMOVIDA']).optional(),
  busca: z.string().max(20).optional(),
  incluirRemovidas: z.enum(['true', 'false']).default('false'),
});

// ---------- Vagas ----------
vagasRouter.get('/', leitura, async (req, res) => {
  const f = filtro.parse(req.query);
  res.set('Cache-Control', 'no-store');
  res.json(await vagasService.listar({ ...f, incluirRemovidas: f.incluirRemovidas === 'true' }));
});

vagasRouter.put('/capacidade', capacidade, async (req, res) => {
  const dados = z
    .object({
      categoriaId: ulidSchema,
      capacidade: z.number().int().min(0).max(5000),
      prefixo: z.string().trim().max(15).optional(),
      setor: texto(40),
      motivo: z.string().trim().min(3, 'Informe o motivo').max(255),
    })
    .parse(req.body);
  res.json(await vagasService.alterarCapacidade(ator(req, dados.motivo), dados));
});

vagasRouter.post('/lote', gerenciar, async (req, res) => {
  res
    .status(201)
    .json(await vagasService.criarLote(ator(req, 'cadastro de vagas em lote'), schemaLote.parse(req.body)));
});

vagasRouter.get('/:id', leitura, async (req, res) => {
  res.json(await vagasService.obter(idDe(req)));
});

vagasRouter.post('/', gerenciar, async (req, res) => {
  res.status(201).json(await vagasService.criar(ator(req, 'cadastro de vaga'), schemaVaga.parse(req.body)));
});

vagasRouter.patch('/:id', gerenciar, async (req, res) => {
  res.json(await vagasService.editar(ator(req, 'edição de vaga'), idDe(req), schemaVaga.parse(req.body)));
});

vagasRouter.post('/:id/bloquear', gerenciar, async (req, res) => {
  const { motivo: m } = motivo.parse(req.body);
  res.json(await vagasService.bloquear(ator(req, m), idDe(req), m));
});

vagasRouter.post('/:id/liberar', gerenciar, async (req, res) => {
  res.json(await vagasService.liberar(ator(req, 'vaga liberada'), idDe(req)));
});

vagasRouter.post('/:id/remover', gerenciar, async (req, res) => {
  const { motivo: m } = motivo.parse(req.body);
  res.json(await vagasService.remover(ator(req, m), idDe(req)));
});

vagasRouter.post('/:id/reativar', gerenciar, async (req, res) => {
  res.json(await vagasService.reativar(ator(req, 'vaga reativada'), idDe(req)));
});

// ---------- Categorias de veículo ----------
categoriasRouter.get('/', leitura, async (_req, res) => {
  res.json({ itens: await vagasService.listarCategorias() } satisfies Lista<Categoria>);
});

categoriasRouter.post('/', gerenciar, async (req, res) => {
  const dados = z
    .object({
      codigo: z.string().trim().min(1).max(20),
      nome: z.string().trim().min(2, 'Informe o nome').max(60),
    })
    .parse(req.body);
  res.status(201).json({ itens: await vagasService.criarCategoria(ator(req, 'categoria criada'), dados) });
});

categoriasRouter.patch('/:id', gerenciar, async (req, res) => {
  const dados = z.object({ nome: z.string().trim().min(2).max(60), ativo: z.boolean() }).parse(req.body);
  res.json({ itens: await vagasService.editarCategoria(ator(req, 'categoria alterada'), idDe(req), dados) });
});
