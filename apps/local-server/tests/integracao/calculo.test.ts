/**
 * Cálculo automático das estadias pela API: o valor acumulado durante a
 * permanência é o mesmo em todas as telas e é exatamente o cobrado na saída.
 */
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { calcularTarifa } from '@estacionamento/calculo';
import type { PreviaSaida, SessaoDetalhe } from '@estacionamento/shared';
import { criarApp } from '../../src/app.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import {
  criarCadastrosBase,
  REGRA_CARRO,
  REGRA_MOTO,
  type CadastrosBase,
} from '../../src/modules/demonstracao/cenario.js';
import { ADMIN, entrar, garantirAdmin } from './ajuda.js';

const app = criarApp();
let admin: Awaited<ReturnType<typeof entrar>>;
let base: CadastrosBase;
let placaSeq = 0;

/** Placa nova a cada chamada (AAA1A00, AAA1A01...). */
const novaPlaca = () => `CAL${Math.floor(placaSeq / 10) % 10}A${String(placaSeq++ % 100).padStart(2, '0')}`;

/** Abre um ticket que entrou há `segundos` (relógio do banco). */
async function ticketHa(
  segundos: number,
  o: { categoria?: 'carro' | 'moto'; modalidade?: 'AVULSO' | 'DIARIA' } = {},
) {
  const r = await admin
    .post('/api/v1/sessoes/entrada')
    .send({
      placa: novaPlaca(),
      categoriaId: base.categorias[o.categoria ?? 'carro'],
      modalidade: o.modalidade ?? 'AVULSO',
    })
    .expect(201);
  const id = r.body.sessao.id as string;
  await pool.query('UPDATE sessoes_estacionamento SET entrada_em = NOW(3) - INTERVAL ? SECOND WHERE id = ?', [
    segundos,
    id,
  ]);
  return id;
}
const ticket = async (id: string) =>
  (await admin.get(`/api/v1/sessoes/${id}`).expect(200)).body as SessaoDetalhe;
const previa = async (id: string, corpo: Record<string, unknown> = {}) =>
  (await admin.post(`/api/v1/sessoes/${id}/previa-saida`).send(corpo).expect(200)).body as PreviaSaida;
const sair = (id: string, valorEsperadoCentavos: number, pagamentos: Record<string, unknown>[]) =>
  admin.post(`/api/v1/sessoes/${id}/saida`).send({
    valorEsperadoCentavos,
    pagamentos: pagamentos.map((p) => ({ chaveIdempotencia: randomUUID(), ...p })),
  });
const encerrarTodos = async () => {
  const [abertas] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM sessoes_estacionamento WHERE status = 'ABERTA'",
  );
  for (const a of abertas)
    await admin.post(`/api/v1/sessoes/${a.id}/cancelar`).send({ motivo: 'limpeza do teste' }).expect(200);
};

beforeAll(async () => {
  const { siteId, usuarioId } = await garantirAdmin();
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  await comTransacao({ usuarioId }, async (c) => {
    base = await criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 30,
      vagasMoto: 10,
      vigenteDesde: new Date(Date.now() - 10 * 24 * 3600_000),
    });
  });
  await admin.post('/api/v1/caixa/abrir').send({ saldoInicialCentavos: 10_000 }).expect(201);
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

const MIN = 60;
const H = 60 * MIN;

describe('valor acumulado durante a permanência (diferentes situações)', () => {
  // Sempre no meio de um minuto (+20 s): o teste não depende de qual milissegundo roda
  it.each([
    ['acabou de entrar', 20, 'carro', 'AVULSO'],
    ['dentro da tolerância', 8 * MIN + 20, 'carro', 'AVULSO'],
    ['logo após a tolerância', 10 * MIN + 20, 'carro', 'AVULSO'],
    ['1ª hora', 45 * MIN + 20, 'carro', 'AVULSO'],
    ['1ª hora + frações', H + 25 * MIN + 20, 'carro', 'AVULSO'],
    ['frações limitadas à hora adicional', H + 50 * MIN + 20, 'carro', 'AVULSO'],
    ['várias horas', 4 * H + 10 * MIN + 20, 'carro', 'AVULSO'],
    ['teto da diária máxima', 9 * H + 20, 'carro', 'AVULSO'],
    ['mais de um dia', 26 * H + 5 * MIN + 20, 'carro', 'AVULSO'],
    ['três dias', 72 * H + 2 * H + 20, 'carro', 'AVULSO'],
    ['moto: hora cheia sem fração', H + 5 * MIN + 20, 'moto', 'AVULSO'],
    ['modo diária, 5 horas', 5 * H + 20, 'carro', 'DIARIA'],
    ['modo diária, mais de 24h', 25 * H + 20, 'carro', 'DIARIA'],
  ] as const)('%s', async (_nome, segundos, categoria, modalidade) => {
    const id = await ticketHa(segundos, { categoria, modalidade });
    const s = await ticket(id);
    const minutos = Math.ceil(segundos / 60);
    const regra = categoria === 'moto' ? REGRA_MOTO : REGRA_CARRO;
    expect(s.calculo.permanenciaMin).toBe(minutos);
    expect(s.calculo.valorCalculadoCentavos).toBe(calcularTarifa(regra, minutos, modalidade));
    expect(s.calculo.aPagarCentavos).toBe(s.calculo.valorCalculadoCentavos);
    expect(s.calculo.itens.reduce((t, i) => t + i.totalCentavos, 0)).toBe(s.calculo.valorCalculadoCentavos);
  });

  it('informa quando o valor sobe e para quanto', async () => {
    const id = await ticketHa(H + 20 * MIN + 20); // 1h20m20s → 81 min → 14,00
    const s = await ticket(id);
    expect(s.calculo.valorCalculadoCentavos).toBe(1400);
    expect(s.calculo.proximaCobranca).toMatchObject({ permanenciaMin: 91, valorCentavos: 1600 });
    // Sobe 1 ms depois de completar 1h30 de permanência
    expect(new Date(s.calculo.proximaCobranca!.em).getTime()).toBe(
      new Date(s.entradaEm).getTime() + 90 * 60_000 + 1,
    );
  });

  it('o mesmo valor em todas as telas no mesmo instante (ticket, lista, veículo, painel, prévia)', async () => {
    await encerrarTodos();
    const id = await ticketHa(2 * H + 40 * MIN + 20); // 161 min
    const s = await ticket(id);
    const esperado = calcularTarifa(REGRA_CARRO, 161);
    const lista = (await admin.get('/api/v1/sessoes/abertas').expect(200)).body.itens as SessaoDetalhe[];
    const veiculo = (await admin.get(`/api/v1/veiculos/${s.veiculoId}`).expect(200)).body;
    const painel = (await admin.get('/api/v1/dashboard').expect(200)).body;
    const p = await previa(id);
    expect(s.calculo.aPagarCentavos).toBe(esperado);
    expect(lista.find((x) => x.id === id)?.calculo.aPagarCentavos).toBe(esperado);
    expect(veiculo.estadiaAtual.valorEstimadoCentavos).toBe(esperado);
    expect(painel.financeiro.pendentes.valorEstimadoCentavos).toBe(esperado);
    expect(p.aPagarCentavos).toBe(esperado);
    expect(p.calculo.itens).toEqual(s.calculo.itens);
  });
});

describe('saída: valor final pelas regras da sessão', () => {
  it('cobra exatamente o valor da prévia, grava o mesmo cálculo e fecha a conta', async () => {
    const id = await ticketHa(3 * H + 10 * MIN + 20); // 191 min → 1000 + 2×600 + 1 fração 200 = 24,00
    const p = await previa(id, {
      pagamentos: [{ forma: 'DINHEIRO', valorCentavos: null, valorRecebidoCentavos: 5000 }],
    });
    expect(p).toMatchObject({
      aPagarCentavos: 2400,
      trocoTotalCentavos: 2600,
      diferencaCentavos: 0,
      problemas: [],
    });
    expect(p.pagamentos).toEqual([
      expect.objectContaining({ valorCentavos: 2400, automatico: true, trocoCentavos: 2600 }),
    ]);

    const r = await sair(id, p.calculo.valorCalculadoCentavos, [
      { forma: 'DINHEIRO', valorCentavos: null, valorRecebidoCentavos: 5000 },
    ]).expect(200);
    expect(r.body.trocoTotalCentavos).toBe(2600);
    expect(r.body.sessao).toMatchObject({ status: 'ENCERRADA', valorFinalCentavos: 2400 });
    expect(r.body.sessao.calculo.itens).toEqual(p.calculo.itens);
    const [pagos] = await pool.query<RowDataPacket[]>(
      "SELECT valor_centavos, troco_centavos FROM pagamentos WHERE sessao_id = ? AND status = 'CONFIRMADO'",
      [id],
    );
    expect(pagos.map((x) => [Number(x.valor_centavos), Number(x.troco_centavos)])).toEqual([[2400, 2600]]);
  });

  it('pagamento dividido: a linha automática fica com o restante', async () => {
    const id = await ticketHa(5 * H + 20); // 300 min → 1000 + 4×600 + 1 fração → 34,00
    const pagamentos = [
      { forma: 'DINHEIRO', valorCentavos: null },
      { forma: 'PIX', valorCentavos: 1000 },
    ];
    const p = await previa(id, { pagamentos });
    expect(p.aPagarCentavos).toBe(calcularTarifa(REGRA_CARRO, 301));
    expect(p.pagamentos.map((x) => [x.forma, x.valorCentavos])).toEqual([
      ['DINHEIRO', p.aPagarCentavos - 1000],
      ['PIX', 1000],
    ]);
    await sair(id, p.calculo.valorCalculadoCentavos, pagamentos).expect(200);
  });

  it('a prévia aponta os problemas que a saída recusaria', async () => {
    const id = await ticketHa(H + 40 * MIN + 20); // 101 min → 16,00
    const p = await previa(id, {
      pagamentos: [
        { forma: 'PIX', valorCentavos: 1000, valorRecebidoCentavos: 2000 },
        { forma: 'DINHEIRO', valorCentavos: 500, valorRecebidoCentavos: 100 },
      ],
    });
    expect(p.diferencaCentavos).toBe(100);
    expect(p.problemas.map((x) => x.mensagem)).toEqual([
      expect.stringMatching(/somam R\$\s15,00, mas o valor a pagar é R\$\s16,00/),
      'Pix (presencial) não tem troco: informe só o valor.',
      'Valor recebido em Dinheiro menor que o valor do pagamento.',
    ]);
    const recusada = await sair(id, p.calculo.valorCalculadoCentavos, [
      { forma: 'PIX', valorCentavos: 1500 },
    ]).expect(422);
    expect(recusada.body.erro.mensagem).toMatch(/somam R\$\s15,00/);
  });

  it('desconto entra no cálculo da prévia e exige permissão', async () => {
    const id = await ticketHa(2 * H + 20); // 121 min → 16,00 + 1 fração = 18,00
    const p = await previa(id, {
      descontoCentavos: 300,
      pagamentos: [{ forma: 'PIX', valorCentavos: null }],
    });
    expect(p).toMatchObject({ descontoCentavos: 300, valorFinalCentavos: 1500, aPagarCentavos: 1500 });
    const maior = await admin
      .post(`/api/v1/sessoes/${id}/previa-saida`)
      .send({ descontoCentavos: 99_999 })
      .expect(422);
    expect(maior.body.erro.mensagem).toBe('O desconto não pode ser maior que o valor da estadia.');
  });

  it('dentro da tolerância: sai sem pagamento', async () => {
    const id = await ticketHa(6 * MIN + 20);
    const p = await previa(id, { pagamentos: [{ forma: 'DINHEIRO', valorCentavos: null }] });
    expect(p).toMatchObject({ aPagarCentavos: 0, pagamentos: [], problemas: [] });
    const r = await sair(id, 0, [{ forma: 'DINHEIRO', valorCentavos: null }]).expect(200);
    expect(r.body.sessao.valorFinalCentavos).toBe(0);
  });

  it('modo diária: 26h cobram 2 diárias', async () => {
    const id = await ticketHa(26 * H + 20, { modalidade: 'DIARIA' });
    const p = await previa(id);
    expect(p.aPagarCentavos).toBe(7000);
    await sair(id, 7000, [{ forma: 'CREDITO', valorCentavos: 7000 }]).expect(200);
  });

  it('encerrado: o valor não é recalculado com o passar do tempo', async () => {
    const id = await ticketHa(H + 20);
    const p = await previa(id);
    await sair(id, p.calculo.valorCalculadoCentavos, [
      { forma: 'PIX', valorCentavos: p.aPagarCentavos },
    ]).expect(200);
    // Mesmo que alguém "mexa" na entrada depois, o ticket encerrado é imutável e o valor gravado vale
    await expect(
      pool.query('UPDATE sessoes_estacionamento SET entrada_em = entrada_em - INTERVAL 5 HOUR WHERE id = ?', [
        id,
      ]),
    ).rejects.toThrow(/não pode ser alterada/);
    const s = await ticket(id);
    expect(s.calculo).toMatchObject({
      valorCalculadoCentavos: p.aPagarCentavos,
      aPagarCentavos: 0,
      proximaCobranca: null,
    });
    await admin.post(`/api/v1/sessoes/${id}/previa-saida`).send({}).expect(409);
  });
});

describe('simulador do servidor (tela de tarifas)', () => {
  it('calcula uma regra ainda não salva e aponta problemas', async () => {
    const regra = {
      toleranciaMin: 10,
      primeiraHoraCentavos: 1000,
      horaAdicionalCentavos: 600,
      fracaoMin: 15,
      fracaoCentavos: 200,
      carenciaMin: 0,
      diariaMaximaCentavos: 4000,
      diariaCentavos: 3500,
      valorFixoCentavos: null,
    };
    const r = await admin
      .post('/api/v1/tarifas/simular')
      .send({ regra, duracoes: [5, 61, 140, 1500], modalidade: 'AVULSO' })
      .expect(200);
    expect(r.body.resultados.map((x: { totalCentavos: number }) => x.totalCentavos)).toEqual([
      0, 1200, 2000, 5000,
    ]);
    const ruim = await admin
      .post('/api/v1/tarifas/simular')
      .send({ regra: { ...regra, carenciaMin: 20 }, duracoes: [60] })
      .expect(200);
    expect(ruim.body.problemas[0]).toMatch(/carência deve ser menor/);
  });

  it('calcula regras publicadas pelo id (mesmo valor da cobrança)', async () => {
    const r = await admin
      .post('/api/v1/tarifas/simular')
      .send({ regraIds: [base.regras.carro, base.regras.moto], duracoes: [140], modalidade: 'DIARIA' })
      .expect(200);
    expect(
      r.body.resultados.map((x: { regraId: string; totalCentavos: number }) => [x.regraId, x.totalCentavos]),
    ).toEqual([
      [base.regras.carro, 3500],
      [base.regras.moto, 1800],
    ]);
  });
});
