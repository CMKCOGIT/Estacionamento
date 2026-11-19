import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DashboardResposta } from '@estacionamento/shared';
import { criarApp } from '../../src/app.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import {
  abrirCaixa,
  cancelarSessao,
  criarCadastrosBase,
  fecharCaixa,
  registrarEntrada,
  registrarPagamento,
  registrarSaida,
  REGRA_CARRO,
} from '../../src/modules/demonstracao/cenario.js';
import { ADMIN, criarUsuario, entrar, garantirAdmin } from './ajuda.js';

const app = criarApp();
let admin: Awaited<ReturnType<typeof entrar>>;
let siteId: string;
let usuarioId: string;
const MIN = 60_000;

async function dashboard(agente = admin): Promise<DashboardResposta> {
  const res = await agente.get('/api/v1/dashboard').expect(200);
  return res.body as DashboardResposta;
}

beforeAll(async () => {
  ({ siteId, usuarioId } = await garantirAdmin());
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

describe('dashboard sem dados operacionais', () => {
  it('mostra zeros reais e alerta que falta configurar vagas e tarifa', async () => {
    const d = await dashboard();
    expect(d.operacao?.vagas).toEqual({ total: 0, disponiveis: 0, ocupadas: 0, bloqueadas: 0 });
    expect(d.operacao?.veiculosEstacionados).toBe(0);
    expect(d.operacao?.ocupacao24h).toHaveLength(25);
    expect(d.financeiro?.faturamentoHojeCentavos).toBe(0);
    expect(d.financeiro?.faturamento7dias).toHaveLength(7);
    expect(d.alertas.map((a) => a.codigo)).toEqual(
      expect.arrayContaining(['config.sem_vagas', 'config.sem_tarifa']),
    );
    expect(d.sincronizacao?.situacao).toBe('NAO_CONFIGURADA');
  });

  it('exige login', async () => {
    const { default: request } = await import('supertest');
    await request(app).get('/api/v1/dashboard').expect(401);
  });
});

describe('dashboard com movimento real', () => {
  const esperado = { faturamentoHoje: 0, faturamentoOntem: 0, entradasHoje: 0 };

  beforeAll(async () => {
    const [[t]] = await pool.query<RowDataPacket[]>(
      `SELECT NOW(3) AS agora, CONVERT_TZ(DATE(CONVERT_TZ(NOW(3), '+00:00', '-03:00')), '-03:00', '+00:00') AS inicio`,
    );
    const agora = t?.agora as Date;
    const inicioHoje = t?.inicio as Date;
    const hoje = (msAntes: number) =>
      new Date(Math.max(inicioHoje.getTime() + 1000, agora.getTime() - msAntes));
    const contarEntrada = (d: Date) => {
      if (d >= inicioHoje) esperado.entradasHoje++;
      return d;
    };

    await comTransacao({ usuarioId }, async (c) => {
      const base = await criarCadastrosBase(c, {
        siteId,
        usuarioId,
        vagasCarro: 4,
        vagasMoto: 2,
        manutencao: 1,
        vigenteDesde: new Date(agora.getTime() - 10 * 24 * 60 * MIN),
      });
      const comum = { siteId, operadorId: usuarioId, postoId: base.postoId };
      const carro = { ...comum, categoriaId: base.categorias.carro, regraId: base.regras.carro };
      const moto = { ...comum, categoriaId: base.categorias.moto, regraId: base.regras.moto };

      // Ontem: saída paga em dinheiro no caixa de ontem (2h = R$ 16,00)
      const caixaOntem = await abrirCaixa(c, {
        ...comum,
        em: new Date(inicioHoje.getTime() - 5 * 60 * MIN),
        saldoInicial: 5000,
      });
      const entradaOntem = contarEntrada(new Date(inicioHoje.getTime() - 3 * 60 * MIN));
      const sOntem = await registrarEntrada(c, {
        ...carro,
        placa: 'ONT1A11',
        vagaId: base.vagas.carro[0]!,
        em: entradaOntem,
      });
      esperado.faturamentoOntem = await registrarSaida(c, {
        ...comum,
        sessaoId: sOntem,
        regra: REGRA_CARRO,
        entradaEm: entradaOntem,
        em: new Date(inicioHoje.getTime() - 60 * MIN),
        caixaId: caixaOntem,
        forma: 'DINHEIRO',
      });
      await fecharCaixa(c, {
        caixaId: caixaOntem,
        em: new Date(inicioHoje.getTime() - 30 * MIN),
        operadorId: usuarioId,
      });

      // Hoje
      const caixa = await abrirCaixa(c, {
        ...comum,
        em: new Date(inicioHoje.getTime() + 500),
        saldoInicial: 0,
      });
      const saidaHoje = hoje(MIN);
      const entradaSaiu = contarEntrada(new Date(saidaHoje.getTime() - 140 * MIN));
      const sSaiu = await registrarEntrada(c, {
        ...carro,
        placa: 'SAI2B22',
        vagaId: base.vagas.carro[0]!,
        em: entradaSaiu,
      });
      esperado.faturamentoHoje += await registrarSaida(c, {
        ...comum,
        sessaoId: sSaiu,
        regra: REGRA_CARRO,
        entradaEm: entradaSaiu,
        em: saidaHoje,
        caixaId: caixa,
        forma: 'PIX',
      });

      const sCancelada = await registrarEntrada(c, {
        ...carro,
        placa: 'CAN3C33',
        vagaId: base.vagas.carro[1]!,
        em: contarEntrada(hoje(2 * MIN)),
      });
      await cancelarSessao(c, {
        sessaoId: sCancelada,
        em: hoje(MIN),
        operadorId: usuarioId,
        motivo: 'entrada duplicada',
      });

      // Abertas: carro 2h20 com R$ 5,00 adiantado; duas motos (setor de motos lotado)
      const entradaA = contarEntrada(new Date(agora.getTime() - 140 * MIN));
      const sA = await registrarEntrada(c, {
        ...carro,
        placa: 'ABE4D44',
        vagaId: base.vagas.carro[1]!,
        em: entradaA,
      });
      await registrarPagamento(c, {
        siteId,
        sessaoId: sA,
        caixaId: caixa,
        forma: 'DEBITO',
        valor: 500,
        operadorId: usuarioId,
        em: hoje(MIN),
      });
      esperado.faturamentoHoje += 500;
      await registrarEntrada(c, {
        ...moto,
        placa: 'MOT5E55',
        vagaId: base.vagas.moto[0]!,
        em: contarEntrada(new Date(agora.getTime() - 30 * MIN)),
      });
      await registrarEntrada(c, {
        ...moto,
        placa: 'MOT6F66',
        vagaId: base.vagas.moto[1]!,
        em: contarEntrada(new Date(agora.getTime() - 50 * MIN)),
      });
    });
  });

  it('indicadores de vagas e veículos', async () => {
    const d = await dashboard();
    // 4 de carro (1 em manutenção) + 2 de moto; ocupadas: 1 carro + 2 motos
    expect(d.operacao?.vagas).toEqual({ total: 6, disponiveis: 2, ocupadas: 3, bloqueadas: 1 });
    expect(d.operacao?.veiculosEstacionados).toBe(3);
    expect(d.operacao?.porCategoria.find((c) => c.codigo === 'MOTO')).toMatchObject({
      total: 2,
      ocupadas: 2,
      disponiveis: 0,
    });
  });

  it('faturamento do dia, de ontem e por forma de pagamento', async () => {
    const f = (await dashboard()).financeiro!;
    expect(f.faturamentoHojeCentavos).toBe(esperado.faturamentoHoje);
    expect(f.faturamentoOntemCentavos).toBe(esperado.faturamentoOntem);
    expect(esperado.faturamentoOntem).toBe(1600);
    expect(f.hojePorForma.find((x) => x.forma === 'DEBITO')).toMatchObject({ centavos: 500, quantidade: 1 });
    expect(f.faturamento7dias.at(-1)?.totalCentavos).toBe(esperado.faturamentoHoje);
    expect(f.caixasAbertos).toHaveLength(1);
  });

  it('pagamentos pendentes calculados pela tarifa real', async () => {
    const f = (await dashboard()).financeiro!;
    // carro 2h20 = 20,00 − 5,00 pago = 15,00; motos de 30 e 50 min = 5,00 cada
    expect(f.pendentes).toEqual({ quantidade: 3, valorEstimadoCentavos: 2500, parcialmentePagas: 1 });
  });

  it('movimento do dia e últimas entradas/saídas', async () => {
    const o = (await dashboard()).operacao!;
    expect(o.hoje.entradas).toBe(esperado.entradasHoje);
    expect(o.hoje.saidas).toBe(1);
    expect(o.hoje.cancelamentos).toBe(1);
    expect(o.hoje.permanenciaMediaMin).toBe(140);
    const tipos = o.ultimosMovimentos.map((m) => m.tipo);
    expect(tipos).toEqual(expect.arrayContaining(['ENTRADA', 'SAIDA', 'CANCELAMENTO']));
    const saida = o.ultimosMovimentos.find((m) => m.placa === 'SAI2B22' && m.tipo === 'SAIDA');
    expect(saida).toMatchObject({
      valorCentavos: 2000,
      permanenciaMin: 140,
      vaga: 'A-02',
      operador: ADMIN.nome,
    });
    const datas = o.ultimosMovimentos.map((m) => m.em);
    expect([...datas].sort().reverse()).toEqual(datas);
  });

  it('gráfico de ocupação termina na ocupação atual', async () => {
    const o = (await dashboard()).operacao!;
    expect(o.ocupacao24h).toHaveLength(25);
    expect(o.ocupacao24h.at(-1)?.ocupadas).toBe(3);
  });

  it('alertas operacionais, do mais grave para o mais leve', async () => {
    const d = await dashboard();
    expect(d.alertas[0]).toMatchObject({ codigo: 'lotado.MOTO', nivel: 'critico', titulo: 'Moto: lotado' });
    expect(d.alertas.map((a) => a.codigo)).toContain('vagas.bloqueadas');
    expect(d.alertas.map((a) => a.codigo)).not.toContain('config.sem_tarifa');
  });

  it('cada seção respeita as permissões do usuário', async () => {
    await criarUsuario({ login: 'dash_op', senha: 'Senha12345', permissoes: ['sessao.consultar'] });
    await criarUsuario({ login: 'dash_nada', senha: 'Senha12345', permissoes: [] });
    const op = await dashboard(await entrar(app, 'dash_op', 'Senha12345'));
    expect(op.operacao).not.toBeNull();
    expect(op.financeiro).toBeNull();
    expect(op.sincronizacao).toBeNull();
    const nada = await dashboard(await entrar(app, 'dash_nada', 'Senha12345'));
    expect(nada).toMatchObject({ operacao: null, financeiro: null, sincronizacao: null });
  });
});
