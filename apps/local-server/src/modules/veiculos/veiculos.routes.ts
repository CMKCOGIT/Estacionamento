import { Router, type Request } from 'express';
import { z } from 'zod';
import { contextoAuditoria, exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { veiculosService, type Ator } from './veiculos.service.js';

export const veiculosRouter = Router();

const leitura = exigirPermissao(
  'veiculo.gerenciar',
  'sessao.consultar',
  'sessao.entrada',
  'sessao.saida',
  'relatorio.operacional',
);
const gerenciar = exigirPermissao('veiculo.gerenciar');

const ulidSchema = z.string().regex(/^[0-9A-Z]{26}$/, 'Identificador inválido');
const idDe = (req: Request) => z.object({ id: ulidSchema }).parse(req.params).id;
const ator = (req: Request, motivo: string): Ator => ({
  usuarioId: req.auth!.id,
  contexto: contextoAuditoria(req, motivo),
});
const texto = (max: number) => z.string().max(max).nullish();

const schemaVeiculo = z.object({
  placa: z.string().trim().min(1, 'Informe a placa').max(12),
  placaEstrangeira: z.boolean().default(false),
  categoriaId: ulidSchema,
  marca: texto(40),
  modelo: texto(60),
  cor: texto(30),
  observacoes: texto(500),
});

const filtro = z.object({
  busca: z.string().trim().max(40).optional(),
  categoriaId: ulidSchema.optional(),
  estacionados: z.enum(['true', 'false']).default('false'),
  pagina: z.coerce.number().int().min(1).max(10_000).default(1),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

veiculosRouter.get('/', leitura, async (req, res) => {
  const f = filtro.parse(req.query);
  res.json(await veiculosService.listar({ ...f, estacionados: f.estacionados === 'true' }));
});

/** Consulta pela placa: GET /veiculos/placa/ABC1D23 (aceita com hífen ou minúsculas). */
veiculosRouter.get('/placa/:placa', leitura, async (req, res) => {
  const { placa } = z.object({ placa: z.string().min(1).max(12) }).parse(req.params);
  res.json(await veiculosService.consultarPlaca(placa));
});

veiculosRouter.get('/:id', leitura, async (req, res) => {
  res.json(await veiculosService.obter(idDe(req)));
});

veiculosRouter.get('/:id/estadias', leitura, async (req, res) => {
  const { pagina, limite } = z
    .object({
      pagina: z.coerce.number().int().min(1).default(1),
      limite: z.coerce.number().int().min(1).max(100).default(20),
    })
    .parse(req.query);
  res.json(await veiculosService.estadias(idDe(req), pagina, limite));
});

veiculosRouter.post('/', gerenciar, async (req, res) => {
  res
    .status(201)
    .json(await veiculosService.criar(ator(req, 'cadastro de veículo'), schemaVeiculo.parse(req.body)));
});

veiculosRouter.patch('/:id', gerenciar, async (req, res) => {
  const dados = schemaVeiculo.extend({ motivo: z.string().trim().max(255).optional() }).parse(req.body);
  res.json(await veiculosService.editar(ator(req, dados.motivo || 'edição de veículo'), idDe(req), dados));
});

veiculosRouter.post('/:id/remover', gerenciar, async (req, res) => {
  const { motivo } = z
    .object({ motivo: z.string().trim().min(3, 'Informe o motivo').max(255) })
    .parse(req.body);
  res.json(await veiculosService.remover(ator(req, motivo), idDe(req)));
});
