import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  HistoricoPlaca,
  IndicadoresOperacionais,
  MovimentoFuncionario,
  RelatorioBloqueios,
  RelatorioMovimento,
  RelatorioOcupacao,
  ResultadoEntrada,
  VeiculoEstacionado,
} from '@estacionamento/shared';
import { criarApp } from '../../src/app.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import { criarCadastrosBase, type CadastrosBase } from '../../src/modules/demonstracao/cenario.js';
import { ADMIN, criarUsuario, entrar, garantirAdmin } from './ajuda.js';

const app = criarApp();
let admin: Awaited<ReturnType<typeof entrar>>;
let operador: Awaited<ReturnType<typeof entrar>>;
let operadorId: string;
let base: CadastrosBase;
const hoje = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10); // fuso -03:00
const periodo = () => `de=${hoje()}&ate=${hoje()}`;

async function entrada(quem: typeof admin, placa: string, minutosAtras: number) {
  const e = (
    await quem.post('/api/v1/sessoes/entrada').send({ placa, categoriaId: base.categorias.carro }).expect(201)
  ).body as ResultadoEntrada;
  await pool.query('UPDATE sessoes_estacionamento SET entrada_em = NOW(3) - INTERVAL ? MINUTE WHERE id = ?', [
    minutosAtras,
    e.sessao.id,
  ]);
  return e.sessao.id;
}
async function saida(quem: typeof admin, id: string) {
  const s = (await quem.get(`/api/v1/sessoes/${id}`).expect(200)).body;
  await quem
    .post(`/api/v1/sessoes/${id}/saida`)
    .send({
      valorEsperadoCentavos: s.calculo.valorCalculadoCentavos,
      pagamentos: s.calculo.valorCalculadoCentavos
        ? [{ forma: 'PIX', valorCentavos: null, chaveIdempotencia: randomUUID() }]
        : [],
    })
    .expect(200);
}

beforeAll(async () => {
  const { siteId, usuarioId } = await garantirAdmin();
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  await comTransacao({ usuarioId }, async (c) => {
    base = await criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 10,
      vagasMoto: 1,
      vigenteDesde: new Date(Date.now() - 2 * 86_400_000),
    });
  });
  operadorId = await criarUsuario({
    login: 'operador-rel',
    senha: 'Senha12345',
    permissoes: ['sessao.entrada', 'sessao.saida', 'sessao.consultar', 'pagamento.registrar', 'caixa.operar'],
  });
  operador = await entrar(app, 'operador-rel', 'Senha12345');
  await admin.post('/api/v1/caixa/abrir').send({ saldoInicialCentavos: 0 }).expect(201);
  await operador.post('/api/v1/caixa/abrir').send({ saldoInicialCentavos: 0 }).expect(201);

  // Cenário: 2 entradas do admin (uma sai), 2 do operador (uma sai pelo operador), 1 cancelada
  const a1 = await entrada(admin, 'REL1A11', 90);
  await entrada(admin, 'REL1A22', 30);
  const o1 = await entrada(operador, 'REL1A33', 75);
  await entrada(operador, 'REL1A44', 5);
  const c1 = await entrada(admin, 'REL1A55', 2);
  await admin.post(`/api/v1/sessoes/${c1}/cancelar`).send({ motivo: 'Placa digitada errada' }).expect(200);
  await saida(admin, a1);
  await saida(operador, o1);
  // Uma segunda visita da mesma placa
  const a2 = await entrada(admin, 'REL1A11', 20);
  await saida(admin, a2);
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

describe('relatórios administrativos', () => {
  it('entradas e saídas: totais, série do dia e filtros (placa, situação, funcionário)', async () => {
    const r = (await admin.get(`/api/v1/relatorios/operacional/movimento?${periodo()}`).expect(200))
      .body as RelatorioMovimento;
    expect(r.totais).toEqual({ entradas: 6, saidas: 3, cancelados: 1, abertos: 2 });
    expect(r.porDia.find((d) => d.dia === hoje())).toMatchObject({ entradas: 6, saidas: 3 });
    expect(r.itens).toHaveLength(6);
    const porPlaca = (await admin.get(`/api/v1/relatorios/operacional/movimento?${periodo()}&placa=REL1A11`))
      .body;
    expect(porPlaca.itens).toHaveLength(2);
    const cancelados = (
      await admin.get(`/api/v1/relatorios/operacional/movimento?${periodo()}&situacao=CANCELADA`)
    ).body as RelatorioMovimento;
    expect(cancelados.itens.map((i) => i.placa)).toEqual(['REL1A55']);
    const doOperador = (
      await admin.get(`/api/v1/relatorios/operacional/movimento?${periodo()}&operadorId=${operadorId}`)
    ).body as RelatorioMovimento;
    expect(doOperador.itens.map((i) => i.placa).sort()).toEqual(['REL1A33', 'REL1A44']);
  });

  it('veículos estacionados agora, com o valor acumulado pelo cálculo do caixa', async () => {
    const r = (await admin.get('/api/v1/relatorios/operacional/estacionados').expect(200)).body as {
      itens: VeiculoEstacionado[];
    };
    expect(r.itens.map((v) => v.placa)).toEqual(['REL1A22', 'REL1A44']); // mais antigo primeiro
    const v = r.itens[0]!;
    const s = (await admin.get(`/api/v1/sessoes/${v.id}`)).body;
    expect(v.valorAcumuladoCentavos).toBe(s.calculo.valorCalculadoCentavos);
  });

  it('histórico por placa: visitas, total pago, permanência média', async () => {
    const r = (await admin.get('/api/v1/relatorios/operacional/placa?placa=rel1a11').expect(200))
      .body as HistoricoPlaca;
    expect(r.resumo.visitas).toBe(2);
    expect(r.estadias).toHaveLength(2);
    expect(r.resumo.totalPagoCentavos).toBe(r.estadias.reduce((t, e) => t + (e.valorFinalCentavos ?? 0), 0));
    expect(r.resumo.permanenciaMediaMin).toBe(Math.round((90 + 20) / 2));
  });

  it('ocupação: pico do dia e perfil horário a partir das entradas e saídas', async () => {
    const r = (await admin.get(`/api/v1/relatorios/operacional/ocupacao?${periodo()}`).expect(200))
      .body as RelatorioOcupacao;
    expect(r.capacidade).toBe(11); // 10 carros + 1 moto
    const dia = r.porDia.find((d) => d.dia === hoje())!;
    // Pouco antes das saídas, 5 tickets se sobrepõem (as duas visitas da REL1A11 foram
    // datadas para trás, sobrepostas); o cancelado não conta
    expect(dia.picoOcupadas).toBe(5);
    expect(r.perfilHorario).toHaveLength(24);
    expect(r.porCategoria.find((c) => c.categoria === 'Carro')?.capacidade).toBe(10);
  });

  it('vagas bloqueadas: atuais e histórico de bloqueio/liberação', async () => {
    const vagas = (await admin.get('/api/v1/vagas').expect(200)).body.itens as {
      id: string;
      estado: string;
      codigo: string;
    }[];
    const livre = vagas.find((v) => v.estado === 'LIVRE')!;
    await admin.post(`/api/v1/vagas/${livre.id}/bloquear`).send({ motivo: 'Pintura do piso' }).expect(200);
    const r = (await admin.get(`/api/v1/relatorios/operacional/bloqueios?${periodo()}`).expect(200))
      .body as RelatorioBloqueios;
    expect(r.atuais).toEqual([
      expect.objectContaining({ codigo: livre.codigo, motivo: 'Pintura do piso', bloqueadaPor: ADMIN.nome }),
    ]);
    expect(r.historico[0]).toMatchObject({ vaga: livre.codigo, acao: 'BLOQUEADA' });
  });

  it('movimentações por funcionário: entradas, saídas, cancelamentos, pagamentos e caixas', async () => {
    const r = (
      await admin.get(`/api/v1/relatorios/operacional/funcionarios/movimento?${periodo()}`).expect(200)
    ).body as {
      itens: MovimentoFuncionario[];
    };
    const op = r.itens.find((x) => x.usuarioId === operadorId)!;
    expect(op).toMatchObject({ entradas: 2, saidas: 1, cancelamentos: 0, caixasAbertos: 1 });
    const adm = r.itens.find((x) => x.nome === ADMIN.nome)!;
    expect(adm).toMatchObject({ entradas: 4, saidas: 2, cancelamentos: 1 });
    expect(op.recebidoCentavos + adm.recebidoCentavos).toBeGreaterThan(0);
  });

  it('indicadores operacionais', async () => {
    const r = (await admin.get(`/api/v1/relatorios/operacional/indicadores?${periodo()}`).expect(200))
      .body as IndicadoresOperacionais;
    expect(r).toMatchObject({
      entradas: 6,
      saidas: 3,
      cancelamentos: 1,
      veiculosAgora: 2,
      vagasBloqueadasAgora: 1,
    });
    expect(r.taxaCancelamento).toBeCloseTo((1 / 6) * 100, 0);
    expect(r.permanenciaMedianaMin).toBe(75);
    expect(r.ticketMedioCentavos).toBeGreaterThan(0);
    expect(r.ocupacaoPicoPct).toBeGreaterThan(0);
  });

  it('filtros validados e permissão exigida', async () => {
    await admin.get('/api/v1/relatorios/operacional/movimento?de=2026-13-01&ate=x').expect(400);
    await admin.get('/api/v1/relatorios/operacional/ocupacao?de=2020-01-01&ate=2026-01-01').expect(400);
    await criarUsuario({ login: 'sem-rel', senha: 'Senha12345', permissoes: ['sessao.entrada'] });
    const sem = await entrar(app, 'sem-rel', 'Senha12345');
    await sem.get(`/api/v1/relatorios/operacional/movimento?${periodo()}`).expect(403);
  });
});
