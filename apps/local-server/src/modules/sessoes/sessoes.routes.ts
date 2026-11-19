import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Lista, SessaoDetalhe } from '@estacionamento/shared';
import { contextoAuditoria, exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { caixaService } from './caixa.service.js';
import { sessoesService, type Ator } from './sessoes.service.js';

export const sessoesRouter = Router();
export const caixaRouter = Router();

const consulta = exigirPermissao('sessao.consultar', 'sessao.entrada', 'sessao.saida');
const ulidSchema = z.string().regex(/^[0-9A-Z]{26}$/, 'Identificador inválido');
const idDe = (req: Request) => z.object({ id: ulidSchema }).parse(req.params).id;
const ator = (req: Request, motivo: string): Ator => ({
  auth: req.auth!,
  contexto: contextoAuditoria(req, motivo),
  origem: `${req.protocol}://${req.get('host')}`,
});
const centavos = z.number().int().min(0).max(10_000_000);

sessoesRouter.get('/abertas', consulta, async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ itens: await sessoesService.abertas() } satisfies Lista<SessaoDetalhe>);
});

/** Localiza pelo número do ticket ou pela placa: GET /sessoes/localizar?termo=ABC1D23 */
sessoesRouter.get('/localizar', consulta, async (req, res) => {
  const { termo } = z
    .object({ termo: z.string().trim().min(1, 'Informe a placa ou o número').max(20) })
    .parse(req.query);
  res.json(await sessoesService.localizar(termo));
});

sessoesRouter.get('/vagas-livres', exigirPermissao('sessao.entrada'), async (req, res) => {
  const { categoriaId } = z.object({ categoriaId: ulidSchema }).parse(req.query);
  res.json({ itens: await sessoesService.vagasLivres(categoriaId) });
});

sessoesRouter.get('/tarifas', exigirPermissao('sessao.entrada'), async (req, res) => {
  const { categoriaId } = z.object({ categoriaId: ulidSchema }).parse(req.query);
  res.set('Cache-Control', 'no-store');
  res.json(await sessoesService.tarifasDaEntrada(categoriaId));
});

sessoesRouter.get('/:id', consulta, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await sessoesService.obter(idDe(req)));
});

sessoesRouter.post('/entrada', exigirPermissao('sessao.entrada'), async (req, res) => {
  const dados = z
    .object({
      placa: z.string().trim().min(1, 'Informe a placa').max(12),
      placaEstrangeira: z.boolean().default(false),
      categoriaId: ulidSchema.optional(),
      vagaId: ulidSchema.nullish(),
      modalidade: z.enum(['AVULSO', 'DIARIA']).default('AVULSO'),
      postoId: ulidSchema.nullish(),
      marca: z.string().max(40).nullish(),
      modelo: z.string().max(60).nullish(),
      cor: z.string().max(30).nullish(),
      tarifaRegraId: ulidSchema.nullish(),
    })
    .parse(req.body);
  res.status(201).json(await sessoesService.registrarEntrada(ator(req, 'entrada de veículo'), dados));
});

sessoesRouter.post('/:id/saida', exigirPermissao('sessao.saida'), async (req, res) => {
  const dados = z
    .object({
      valorEsperadoCentavos: centavos,
      pagamentos: z
        .array(
          z.object({
            forma: z
              .string()
              .regex(/^[A-Z][A-Z0-9_]*$/)
              .max(20),
            valorCentavos: centavos,
            valorRecebidoCentavos: centavos.nullish(),
            autorizacao: z.string().trim().max(40).nullish(),
            parcelas: z.number().int().min(1).max(24).optional(),
            chaveIdempotencia: z.uuid('Chave de idempotência inválida'),
          }),
        )
        .max(10),
      descontoCentavos: centavos.default(0),
      acrescimoCentavos: centavos.default(0),
      motivoAjuste: z.string().trim().max(255).nullish(),
      postoId: ulidSchema.nullish(),
    })
    .parse(req.body);
  res.json(await sessoesService.registrarSaida(ator(req, 'saída de veículo'), idDe(req), dados));
});

sessoesRouter.post('/:id/cancelar', exigirPermissao('sessao.cancelar'), async (req, res) => {
  const { motivo } = z
    .object({ motivo: z.string().trim().min(3, 'Informe o motivo').max(255) })
    .parse(req.body);
  res.json(await sessoesService.cancelar(ator(req, motivo), idDe(req), motivo));
});

sessoesRouter.post('/:id/novo-link', exigirPermissao('sessao.token_revogar'), async (req, res) => {
  res.json(await sessoesService.novoAcesso(ator(req, 'novo link do cliente'), idDe(req)));
});

// ---------- Caixa do operador ----------
const operaCaixa = exigirPermissao('caixa.operar');

caixaRouter.get(
  '/postos',
  exigirPermissao('caixa.operar', 'sessao.entrada', 'sessao.saida'),
  async (_req, res) => {
    res.json({ itens: await caixaService.postos() });
  },
);

caixaRouter.get(
  '/formas',
  exigirPermissao('caixa.operar', 'pagamento.registrar', 'sessao.saida'),
  async (_req, res) => {
    res.json({ itens: await caixaService.formas() });
  },
);

caixaRouter.get('/atual', operaCaixa, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ caixa: await caixaService.atual(req.auth!.id) });
});

caixaRouter.post('/abrir', operaCaixa, async (req, res) => {
  const { postoId, saldoInicialCentavos } = z
    .object({ postoId: ulidSchema.nullish(), saldoInicialCentavos: centavos.default(0) })
    .parse(req.body);
  res.status(201).json(
    await caixaService.abrir({
      operadorId: req.auth!.id,
      contexto: contextoAuditoria(req),
      postoId,
      saldoInicialCentavos,
    }),
  );
});

caixaRouter.post('/fechar', operaCaixa, async (req, res) => {
  const d = z
    .object({ saldoContadoCentavos: centavos, observacao: z.string().trim().max(500).nullish() })
    .parse(req.body);
  res.json(await caixaService.fechar({ operadorId: req.auth!.id, contexto: contextoAuditoria(req), ...d }));
});
