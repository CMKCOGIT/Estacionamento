import { Router, type Request } from 'express';
import { z } from 'zod';
import type { RowDataPacket } from 'mysql2/promise';
import type {
  CaixaAtual,
  Lista,
  MovimentacaoHistorico,
  ResultadoFechamentoCaixa,
  SessaoDetalhe,
} from '@estacionamento/shared';
import { env } from '../../config/env.js';
import { obterSiteAtual } from '../../config/site.js';
import { pool } from '../../db/pool.js';
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

/**
 * Histórico de entradas e saídas (Operação → Movimentações). Quem não
 * supervisiona (Operador) vê só as que ele mesmo registrou.
 */
sessoesRouter.get('/historico', consulta, async (req, res) => {
  const f = z
    .object({
      busca: z.string().trim().max(20).optional(),
      categoriaId: z
        .string()
        .regex(/^[0-9A-Z]{26}$/)
        .optional(),
      situacao: z.enum(['ABERTA', 'ENCERRADA', 'CANCELADA']).optional(),
      de: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      ate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      limite: z.coerce.number().int().min(1).max(200).default(50),
      antesDe: z
        .string()
        .regex(/^[0-9A-Z]{26}$/)
        .optional(),
    })
    .parse(req.query);
  const auth = req.auth!;
  const todas = auth.temPermissao('relatorio.operacional') || auth.temPermissao('caixa.supervisionar');
  const site = await obterSiteAtual();
  const where = ['s.site_id = ?'];
  const params: unknown[] = [site.id];
  if (!todas) {
    where.push('(s.operador_entrada_id = ? OR s.operador_saida_id = ?)');
    params.push(auth.id, auth.id);
  }
  if (f.busca) {
    where.push('(s.placa LIKE ? OR s.numero = ?)');
    params.push(`%${f.busca.toUpperCase().replace(/[^A-Z0-9]/g, '')}%`, f.busca);
  }
  const se = (valor: unknown, sql: string) => {
    if (!valor) return;
    where.push(sql);
    params.push(valor);
  };
  se(f.categoriaId, 's.categoria_id = ?');
  se(f.situacao, 's.status = ?');
  se(f.de, `s.entrada_em >= CONVERT_TZ(?, '${env.FUSO_OFFSET}', '+00:00')`);
  se(f.ate, `s.entrada_em < CONVERT_TZ(? + INTERVAL 1 DAY, '${env.FUSO_OFFSET}', '+00:00')`);
  se(f.antesDe, 's.id < ?');
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT s.id, s.numero, s.placa, s.status, s.entrada_em, s.saida_em, s.cancelado_em, s.valor_final_centavos,
            c.nome AS categoria, c.codigo AS categoria_codigo, v.codigo AS vaga,
            COALESCE(fe.nome, ue.login) AS operador_entrada, COALESCE(fs.nome, us.login) AS operador_saida
       FROM sessoes_estacionamento s
       JOIN categorias_veiculo c ON c.id = s.categoria_id
       LEFT JOIN vagas v ON v.id = s.vaga_id
       LEFT JOIN usuarios ue ON ue.id = s.operador_entrada_id
       LEFT JOIN funcionarios fe ON fe.usuario_id = ue.id
       LEFT JOIN usuarios us ON us.id = s.operador_saida_id
       LEFT JOIN funcionarios fs ON fs.usuario_id = us.id
      WHERE ${where.join(' AND ')}
      ORDER BY s.id DESC
      LIMIT ?`,
    [...params, f.limite + 1],
  );
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
  const itens: MovimentacaoHistorico[] = linhas.slice(0, f.limite).map((l) => ({
    id: String(l.id),
    numero: String(l.numero),
    placa: String(l.placa),
    categoria: String(l.categoria),
    categoriaCodigo: String(l.categoria_codigo),
    vaga: (l.vaga as string | null) ?? null,
    entradaEm: iso(l.entrada_em) ?? '',
    saidaEm: iso(l.saida_em),
    canceladoEm: iso(l.cancelado_em),
    status: l.status,
    operadorEntrada: (l.operador_entrada as string | null) ?? null,
    operadorSaida: (l.operador_saida as string | null) ?? null,
    valorFinalCentavos: l.valor_final_centavos === null ? null : Number(l.valor_final_centavos),
  }));
  res.set('Cache-Control', 'no-store').json({
    itens,
    proximaPagina: linhas.length > f.limite ? (itens.at(-1)?.id ?? null) : null,
    somenteMinhas: !todas,
  });
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
            // null = completa automaticamente o que faltar
            valorCentavos: centavos.nullable(),
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

/** Prévia da saída: valor agora, ajustes, pagamentos conferidos e troco. Não grava nada. */
sessoesRouter.post('/:id/previa-saida', exigirPermissao('sessao.saida'), async (req, res) => {
  const dados = z
    .object({
      pagamentos: z
        .array(
          z.object({
            forma: z
              .string()
              .regex(/^[A-Z][A-Z0-9_]*$/)
              .max(20),
            valorCentavos: centavos.nullable(),
            valorRecebidoCentavos: centavos.nullish(),
            parcelas: z.number().int().min(1).max(24).optional(),
          }),
        )
        .max(10)
        .default([]),
      descontoCentavos: centavos.default(0),
      acrescimoCentavos: centavos.default(0),
    })
    .parse(req.body ?? {});
  res.set('Cache-Control', 'no-store');
  res.json(await sessoesService.previaSaida(ator(req, 'prévia de saída'), idDe(req), dados));
});

/** Recebe um pagamento com o veículo ainda no estacionamento (antecipado/parcial). */
sessoesRouter.post('/:id/pagamentos', exigirPermissao('pagamento.registrar'), async (req, res) => {
  const d = z
    .object({
      forma: z
        .string()
        .regex(/^[A-Z][A-Z0-9_]*$/)
        .max(20),
      valorCentavos: centavos.nullable(),
      valorRecebidoCentavos: centavos.nullish(),
      autorizacao: z.string().trim().max(40).nullish(),
      parcelas: z.number().int().min(1).max(24).optional(),
      chaveIdempotencia: z.uuid('Chave de idempotência inválida'),
      confirmarDuplicidade: z.boolean().default(false),
    })
    .parse(req.body);
  const r = await sessoesService.receber(ator(req, 'pagamento antecipado'), idDe(req), d);
  res.status(r.repetido ? 200 : 201).json(r);
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

/**
 * Conferência às cegas: quem não supervisiona caixas (Operador) nunca recebe
 * o dinheiro esperado, os totais por forma nem a diferença do fechamento.
 */
const veConferencia = (req: Request) =>
  req.auth!.temPermissao('caixa.supervisionar') || req.auth!.temPermissao('relatorio.financeiro');
const caixaParaQuemPede = (req: Request, c: CaixaAtual | null): CaixaAtual | null =>
  c && !veConferencia(req)
    ? { ...c, dinheiroEsperadoCentavos: null, recebidoPorForma: [], conferenciaOculta: true }
    : c;

caixaRouter.get('/atual', operaCaixa, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ caixa: caixaParaQuemPede(req, await caixaService.atual(req.auth!.id)) });
});

caixaRouter.post('/abrir', operaCaixa, async (req, res) => {
  const { postoId, saldoInicialCentavos } = z
    .object({ postoId: ulidSchema.nullish(), saldoInicialCentavos: centavos.default(0) })
    .parse(req.body);
  res.status(201).json(
    caixaParaQuemPede(
      req,
      await caixaService.abrir({
        operadorId: req.auth!.id,
        contexto: contextoAuditoria(req),
        postoId,
        saldoInicialCentavos,
      }),
    ),
  );
});

caixaRouter.post('/movimentar', exigirPermissao('caixa.sangria'), async (req, res) => {
  const d = z
    .object({
      tipo: z.enum(['SANGRIA', 'SUPRIMENTO']),
      valorCentavos: centavos.min(1, 'Informe o valor'),
      descricao: z.string().trim().min(3, 'Informe o motivo').max(255),
    })
    .parse(req.body);
  res.json(
    caixaParaQuemPede(
      req,
      await caixaService.movimentar({
        operadorId: req.auth!.id,
        contexto: contextoAuditoria(req, d.descricao),
        ...d,
      }),
    ),
  );
});

caixaRouter.post('/fechar', operaCaixa, async (req, res) => {
  const d = z
    .object({ saldoContadoCentavos: centavos, observacao: z.string().trim().max(500).nullish() })
    .parse(req.body);
  const r = await caixaService.fechar({ operadorId: req.auth!.id, contexto: contextoAuditoria(req), ...d });
  // O resultado da conferência fica gravado; só gerente/administrador o vê
  res.json(
    veConferencia(req)
      ? r
      : ({
          ...r,
          esperadoCentavos: null,
          diferencaCentavos: null,
          conferenciaOculta: true,
        } satisfies ResultadoFechamentoCaixa),
  );
});
