/**
 * Relatórios financeiros sobre um histórico conhecido (dias, semanas e meses
 * diferentes, fuso -03:00): cada total é conferido com o valor exato.
 */
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  DetalheMovimentacao,
  RelatorioFaturamento,
  RelatorioFechamentos,
  RelatorioFormas,
  RelatorioPendentes,
} from '@estacionamento/shared';
import { criarApp } from '../../src/app.js';
import type { Conexao } from '../../src/db/pool.js';
import { fecharPool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import * as cen from '../../src/modules/demonstracao/cenario.js';
import { ADMIN, criarUsuario, entrar, garantirAdmin } from './ajuda.js';

const app = criarApp();
let admin: Awaited<ReturnType<typeof entrar>>;
let estornoMovId: string;
let estornoPagamentoId: string;
const local = (iso: string) => new Date(`${iso}-03:00`);
const MIN = 60_000;
const rel = async <T>(caminho: string) =>
  (await admin.get(`/api/v1/relatorios${caminho}`).expect(200)).body as T;

/** Um ticket do carro: entra, (opcional) paga antes, sai pagando o restante numa forma. */
async function estadia(
  c: Conexao,
  base: cen.CadastrosBase,
  ctx: { siteId: string; usuarioId: string; caixaId: string },
  o: { placa: string; entrada: string; minutos: number; forma: string },
) {
  const entradaEm = local(o.entrada);
  const sessaoId = await cen.registrarEntrada(c, {
    siteId: ctx.siteId,
    placa: o.placa,
    categoriaId: base.categorias.carro,
    vagaId: null,
    regraId: base.regras.carro,
    operadorId: ctx.usuarioId,
    postoId: base.postoId,
    em: entradaEm,
  });
  await cen.registrarSaida(c, {
    siteId: ctx.siteId,
    sessaoId,
    regra: cen.REGRA_CARRO,
    entradaEm,
    em: new Date(entradaEm.getTime() + o.minutos * MIN),
    caixaId: ctx.caixaId,
    forma: o.forma,
    operadorId: ctx.usuarioId,
    postoId: base.postoId,
  });
  return sessaoId;
}

beforeAll(async () => {
  const { siteId, usuarioId } = await garantirAdmin();
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  await comTransacao({ usuarioId }, async (c) => {
    const base = await cen.criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 10,
      vagasMoto: 2,
      vigenteDesde: new Date('2026-10-01T00:00:00Z'),
    });
    const caixa = async (dia: string) =>
      cen.abrirCaixa(c, {
        siteId,
        postoId: base.postoId,
        operadorId: usuarioId,
        em: local(`${dia}T07:00:00`),
        saldoInicial: 5000,
      });
    const fechar = (caixaId: string, quando: string) =>
      cen.fecharCaixa(c, { caixaId, em: local(quando), operadorId: usuarioId });

    // Período anterior (para a comparação): 25/10, R$ 10,00
    let cx = await caixa('2026-10-25');
    await estadia(
      c,
      base,
      { siteId, usuarioId, caixaId: cx },
      { placa: 'ANT1A00', entrada: '2026-10-25T12:00:00', minutos: 60, forma: 'PIX' },
    );
    await fechar(cx, '2026-10-25T20:00:00');

    // Qui 29/10: Pix 10,00 (1h) + Dinheiro 20,00 (2h20)
    cx = await caixa('2026-10-29');
    await estadia(
      c,
      base,
      { siteId, usuarioId, caixaId: cx },
      { placa: 'QUI1A01', entrada: '2026-10-29T12:00:00', minutos: 60, forma: 'PIX' },
    );
    await estadia(
      c,
      base,
      { siteId, usuarioId, caixaId: cx },
      { placa: 'QUI1A02', entrada: '2026-10-29T13:00:00', minutos: 140, forma: 'DINHEIRO' },
    );
    await fechar(cx, '2026-10-29T20:00:00');

    // Sáb 31/10 às 23:30 (02:30 UTC de 01/11): Débito 10,00 — conta em 31/10 e em outubro
    cx = await caixa('2026-10-31');
    await estadia(
      c,
      base,
      { siteId, usuarioId, caixaId: cx },
      { placa: 'SAB1A03', entrada: '2026-10-31T23:00:00', minutos: 30, forma: 'DEBITO' },
    );
    await fechar(cx, '2026-10-31T23:50:00');

    // Seg 02/11: Pix 5,00 antecipado e estornado; saída no Crédito 10,00
    cx = await caixa('2026-11-02');
    const entrada = local('2026-11-02T11:30:00');
    const sessaoId = await cen.registrarEntrada(c, {
      siteId,
      placa: 'SEG1A04',
      categoriaId: base.categorias.carro,
      vagaId: null,
      regraId: base.regras.carro,
      operadorId: usuarioId,
      postoId: base.postoId,
      em: entrada,
    });
    estornoPagamentoId = await cen.registrarPagamento(c, {
      siteId,
      sessaoId,
      caixaId: cx,
      forma: 'PIX',
      valor: 500,
      operadorId: usuarioId,
      em: local('2026-11-02T12:00:00'),
    });
    await cen.estornarPagamento(c, {
      siteId,
      pagamentoId: estornoPagamentoId,
      caixaId: cx,
      operadorId: usuarioId,
      em: local('2026-11-02T12:05:00'),
      motivo: 'Lançado errado',
    });
    await cen.registrarSaida(c, {
      siteId,
      sessaoId,
      regra: cen.REGRA_CARRO,
      entradaEm: entrada,
      em: local('2026-11-02T12:30:00'),
      caixaId: cx,
      forma: 'CREDITO',
      operadorId: usuarioId,
      postoId: base.postoId,
    });
    // Ter 03/11: só um ticket dentro da tolerância (sem cobrança)
    await estadia(
      c,
      base,
      { siteId, usuarioId, caixaId: cx },
      { placa: 'TER1A05', entrada: '2026-11-03T09:00:00', minutos: 5, forma: 'PIX' },
    );
    await fechar(cx, '2026-11-03T20:00:00');

    const [[m]] = await c.query<RowDataPacket[]>(
      "SELECT id FROM movimentacoes_financeiras WHERE tipo = 'ESTORNO'",
    );
    estornoMovId = String(m?.id);
  });
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

const PERIODO = 'de=2026-10-29&ate=2026-11-03';

describe('faturamento', () => {
  it('diário: um ponto por dia (inclusive sem movimento), no fuso do estacionamento', async () => {
    const r = await rel<RelatorioFaturamento>(`/faturamento?${PERIODO}&agrupar=DIA`);
    expect(r.pontos.map((p) => [p.inicio, p.liquidoCentavos, p.ticketsEncerrados])).toEqual([
      ['2026-10-29', 3000, 2],
      ['2026-10-30', 0, 0],
      ['2026-10-31', 1000, 1], // 23:30 local, mesmo sendo 02:30 UTC do dia seguinte
      ['2026-11-01', 0, 0],
      ['2026-11-02', 1000, 1], // 5,00 + 10,00 recebidos − 5,00 estornados
      ['2026-11-03', 0, 1], // ticket sem cobrança
    ]);
    expect(r.pontos[4]).toMatchObject({
      recebidoCentavos: 1500,
      estornadoCentavos: 500,
      quantidadePagamentos: 2,
      quantidadeEstornos: 1,
    });
    expect(r.pontos[0]!.porForma).toEqual([
      { forma: 'DINHEIRO', liquidoCentavos: 2000 },
      { forma: 'PIX', liquidoCentavos: 1000 },
    ]);
  });

  it('totais, ticket médio, média diária e comparação com o período anterior', async () => {
    const r = await rel<RelatorioFaturamento>(`/faturamento?${PERIODO}&agrupar=DIA`);
    expect(r.totais).toMatchObject({
      recebidoCentavos: 5500,
      estornadoCentavos: 500,
      liquidoCentavos: 5000,
      quantidadePagamentos: 5,
      quantidadeEstornos: 1,
      ticketsEncerrados: 5,
      ticketsSemCobranca: 1,
      faturadoTicketsCentavos: 5000,
      ticketMedioCentavos: 1250,
      dias: 6,
      mediaDiariaCentavos: 833,
    });
    expect(r.anterior).toMatchObject({
      de: '2026-10-23',
      ate: '2026-10-28',
      totais: { liquidoCentavos: 1000 },
    });
    expect(r.variacaoLiquidoPct).toBe(400);
  });

  it('semanal (segunda a domingo, cortado no período) e mensal', async () => {
    const s = await rel<RelatorioFaturamento>(`/faturamento?${PERIODO}&agrupar=SEMANA`);
    expect(s.pontos.map((p) => [p.inicio, p.fim, p.liquidoCentavos])).toEqual([
      ['2026-10-29', '2026-11-01', 4000],
      ['2026-11-02', '2026-11-03', 1000],
    ]);
    const m = await rel<RelatorioFaturamento>(`/faturamento?${PERIODO}&agrupar=MES`);
    expect(m.pontos.map((p) => [p.inicio, p.fim, p.liquidoCentavos])).toEqual([
      ['2026-10-29', '2026-10-31', 4000],
      ['2026-11-01', '2026-11-03', 1000],
    ]);
    // O agrupamento não muda o total
    expect(s.totais).toEqual((await rel<RelatorioFaturamento>(`/faturamento?${PERIODO}&agrupar=DIA`)).totais);
    expect(m.totais.liquidoCentavos).toBe(s.totais.liquidoCentavos);
  });

  it('o total diário confere com o resumo do dia do módulo financeiro', async () => {
    const r = await rel<RelatorioFaturamento>('/faturamento?de=2026-11-02&ate=2026-11-02');
    const resumo = (await admin.get('/api/v1/financeiro/resumo?data=2026-11-02').expect(200)).body;
    expect(r.totais).toMatchObject({
      recebidoCentavos: resumo.recebidoCentavos,
      estornadoCentavos: resumo.estornadoCentavos,
      liquidoCentavos: resumo.liquidoCentavos,
      quantidadePagamentos: resumo.quantidadePagamentos,
    });
  });

  it('valida o período', async () => {
    const erro = async (q: string) =>
      (await admin.get(`/api/v1/relatorios/faturamento?${q}`).expect(400)).body.erro.mensagem;
    expect(await erro('de=2026-11-03&ate=2026-10-29')).toMatch(/inicial é depois da final/);
    expect(await erro('de=2024-01-01&ate=2026-01-01&agrupar=DIA')).toMatch(/Agrupe por semana ou mês/);
    expect(await erro('de=2999-01-01&ate=2999-01-02')).toMatch(/futuro/);
    await admin.get('/api/v1/relatorios/faturamento?de=2024-01-01&ate=2026-01-01&agrupar=MES').expect(200);
  });
});

describe('formas de pagamento', () => {
  it('recebido, estornado, líquido e participação por forma', async () => {
    const r = await rel<RelatorioFormas>(`/formas?${PERIODO}`);
    expect(
      r.formas.map((f) => [
        f.forma,
        f.quantidade,
        f.recebidoCentavos,
        f.estornadoCentavos,
        f.liquidoCentavos,
        f.percentual,
      ]),
    ).toEqual([
      ['DINHEIRO', 1, 2000, 0, 2000, 40],
      ['PIX', 2, 1500, 500, 1000, 20],
      ['DEBITO', 1, 1000, 0, 1000, 20],
      ['CREDITO', 1, 1000, 0, 1000, 20],
    ]);
    expect(r.totais).toEqual({
      quantidade: 5,
      recebidoCentavos: 5500,
      estornadoCentavos: 500,
      liquidoCentavos: 5000,
    });
    const fat = await rel<RelatorioFaturamento>(`/faturamento?${PERIODO}`);
    expect(r.totais.liquidoCentavos).toBe(fat.totais.liquidoCentavos);
  });
});

describe('fechamentos de caixa', () => {
  it('lista os caixas fechados no período, com totais de conferência', async () => {
    const r = await rel<RelatorioFechamentos>(`/fechamentos?${PERIODO}`);
    expect(r.itens).toHaveLength(3);
    expect(r.totais).toMatchObject({
      quantidade: 3,
      conferidos: 3,
      comFalta: 0,
      comSobra: 0,
      diferencaLiquidaCentavos: 0,
    });
    expect(r.totais.recebidoCentavos).toBe(5500);
  });

  it('fechamento com diferença aparece como sobra/falta', async () => {
    await admin.post('/api/v1/caixa/abrir').send({ saldoInicialCentavos: 1000 }).expect(201);
    await admin
      .post('/api/v1/caixa/fechar')
      .send({ saldoContadoCentavos: 900, observacao: 'Faltou uma moeda' })
      .expect(200);
    const hoje = (await admin.get('/api/v1/financeiro/resumo').expect(200)).body.data as string;
    const r = await rel<RelatorioFechamentos>(`/fechamentos?de=${hoje}&ate=${hoje}`);
    expect(r.totais).toMatchObject({
      quantidade: 1,
      comFalta: 1,
      faltaCentavos: 100,
      diferencaLiquidaCentavos: -100,
    });
    expect(r.itens[0]).toMatchObject({ diferencaCentavos: -100, observacao: 'Faltou uma moeda' });
  });
});

describe('pendentes e detalhe das movimentações', () => {
  it('pendentes por tempo de permanência', async () => {
    const r = await rel<RelatorioPendentes>('/pendentes');
    expect(r.faixas.map((f) => f.rotulo)).toEqual([
      'Até 1 hora',
      '1 a 3 horas',
      '3 a 6 horas',
      '6 a 24 horas',
      'Mais de 24 horas',
    ]);
    expect(r.faixas.reduce((t, f) => t + f.quantidade, 0)).toBe(r.quantidade);
    expect(r.faixas.reduce((t, f) => t + f.totalCentavos, 0)).toBe(r.totalCentavos);
  });

  it('detalhe do estorno: pagamento, ticket, caixa, movimentações relacionadas e histórico', async () => {
    const d = await rel<DetalheMovimentacao>(`/detalhe?movimentacaoId=${estornoMovId}`);
    expect(d.movimentacao).toMatchObject({ tipo: 'ESTORNO', valorCentavos: 500, forma: 'PIX' });
    expect(d.pagamento).toMatchObject({
      id: estornoPagamentoId,
      status: 'ESTORNADO',
      motivoEstorno: 'Lançado errado',
      placa: 'SEG1A04',
    });
    expect(d.ticket).toMatchObject({ placa: 'SEG1A04', status: 'ENCERRADA', valorFinalCentavos: 1000 });
    expect(d.caixa?.status).toBe('FECHADO');
    expect(d.relacionadas.map((m) => [m.tipo, m.forma, m.valorCentavos])).toEqual([
      ['RECEBIMENTO', 'PIX', 500],
      ['RECEBIMENTO', 'CREDITO', 1000],
    ]);
    expect(d.historico.map((h) => h.acao)).toEqual(['pagamento.registrado', 'pagamento.estornado']);
  });

  it('detalhe pelo pagamento; inexistente = 404', async () => {
    const d = await rel<DetalheMovimentacao>(`/detalhe?pagamentoId=${estornoPagamentoId}`);
    expect(d.movimentacao).toBeNull();
    expect(d.relacionadas.some((m) => m.tipo === 'ESTORNO')).toBe(true);
    await admin.get('/api/v1/relatorios/detalhe?pagamentoId=00000000000000000000000000').expect(404);
    await admin.get('/api/v1/relatorios/detalhe').expect(400);
  });

  it('operador de caixa não vê relatórios financeiros', async () => {
    await criarUsuario({
      login: 'op.rel',
      senha: 'Painel2026x',
      perfil: 'funcionario',
      permissoes: ['sessao.entrada', 'sessao.saida', 'pagamento.registrar', 'caixa.operar'],
    });
    const op = await entrar(app, 'op.rel', 'Painel2026x');
    await op.get(`/api/v1/relatorios/faturamento?${PERIODO}`).expect(403);
    await op.get('/api/v1/relatorios/pendentes').expect(403);
  });
});
