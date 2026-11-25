import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  CaixaDetalhe,
  ListaPagamentos,
  ListaPendencias,
  ResultadoPagamento,
  ResumoFinanceiroDia,
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
let base: CadastrosBase;
let seq = 0;
const MIN = 60;

const novaPlaca = () => `FIN${Math.floor(seq / 100) % 10}B${String(seq++ % 100).padStart(2, '0')}`;
async function ticketHa(segundos: number, agente = admin) {
  const r = await agente
    .post('/api/v1/sessoes/entrada')
    .send({ placa: novaPlaca(), categoriaId: base.categorias.carro })
    .expect(201);
  const id = r.body.sessao.id as string;
  await pool.query('UPDATE sessoes_estacionamento SET entrada_em = NOW(3) - INTERVAL ? SECOND WHERE id = ?', [
    segundos,
    id,
  ]);
  return id;
}
const receber = (id: string, corpo: Record<string, unknown>, agente = admin) =>
  agente.post(`/api/v1/sessoes/${id}/pagamentos`).send({ chaveIdempotencia: randomUUID(), ...corpo });
const contar = async (sql: string, p: unknown[]) =>
  Number((await pool.query<RowDataPacket[]>(sql, p))[0][0]?.n);
const pagamentosDo = (id: string) => contar('SELECT COUNT(*) AS n FROM pagamentos WHERE sessao_id = ?', [id]);
const movimentosDo = (id: string) =>
  contar('SELECT COUNT(*) AS n FROM movimentacoes_financeiras WHERE sessao_id = ?', [id]);

beforeAll(async () => {
  const { siteId, usuarioId } = await garantirAdmin();
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  await comTransacao({ usuarioId }, async (c) => {
    base = await criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 40,
      vagasMoto: 2,
      vigenteDesde: new Date(Date.now() - 10 * 24 * 3600_000),
    });
  });
  await criarUsuario({
    login: 'caixa.ana',
    senha: 'Painel2026x',
    perfil: 'funcionario',
    permissoes: ['sessao.entrada', 'sessao.saida', 'sessao.consultar', 'pagamento.registrar', 'caixa.operar'],
  });
  operador = await entrar(app, 'caixa.ana', 'Painel2026x');
  await admin.post('/api/v1/caixa/abrir').send({ saldoInicialCentavos: 10_000 }).expect(201);
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

describe('registro de pagamento associado à estadia (antecipado/parcial)', () => {
  let id: string;
  let chave: string;

  it('recebe o valor em aberto: fica no ticket e no caixa', async () => {
    id = await ticketHa(80 * MIN + 20); // 81 min → 14,00
    chave = randomUUID();
    const r = await receber(id, { forma: 'PIX', valorCentavos: null, chaveIdempotencia: chave }).expect(201);
    const body = r.body as ResultadoPagamento;
    expect(body).toMatchObject({
      repetido: false,
      trocoCentavos: 0,
      pagamento: { forma: 'PIX', valorCentavos: 1400 },
    });
    expect(body.sessao.calculo).toMatchObject({ pagoCentavos: 1400, aPagarCentavos: 0 });
    expect(await pagamentosDo(id)).toBe(1);
    expect(await movimentosDo(id)).toBe(1);
  });

  it('reenviar a mesma operação (duplo clique, rede caiu) não registra de novo', async () => {
    const r = await receber(id, { forma: 'PIX', valorCentavos: null, chaveIdempotencia: chave }).expect(200);
    expect(r.body.repetido).toBe(true);
    expect(r.body.pagamento.valorCentavos).toBe(1400);
    // Dez reenvios simultâneos também não duplicam
    const lote = await Promise.all(
      Array.from({ length: 10 }, () =>
        receber(id, { forma: 'PIX', valorCentavos: null, chaveIdempotencia: chave }),
      ),
    );
    expect(lote.every((x) => x.status === 200 && x.body.repetido)).toBe(true);
    expect(await pagamentosDo(id)).toBe(1);
    expect(await movimentosDo(id)).toBe(1);
  });

  it('a mesma chave com outros dados é recusada', async () => {
    const r = await receber(id, { forma: 'DINHEIRO', valorCentavos: 100, chaveIdempotencia: chave }).expect(
      409,
    );
    expect(r.body.erro.detalhes.motivo).toBe('CHAVE_REUTILIZADA');
  });

  it('nada em aberto: não recebe; nunca recebe mais que o valor em aberto', async () => {
    const r = await receber(id, { forma: 'PIX', valorCentavos: null }).expect(422);
    expect(r.body.erro.mensagem).toMatch(/não tem valor em aberto/);
    await pool.query(
      'UPDATE sessoes_estacionamento SET entrada_em = entrada_em - INTERVAL 30 MINUTE WHERE id = ?',
      [id],
    ); // 111 min → 16,00
    const maior = await receber(id, { forma: 'PIX', valorCentavos: 500 }).expect(422);
    expect(maior.body.erro.mensagem).toMatch(/maior que o valor em aberto agora \(R\$\s2,00\)/);
  });

  it('pagamento igual registrado há pouco pede confirmação (provável lançamento em dobro)', async () => {
    const id2 = await ticketHa(5 * 60 * MIN + 20); // 301 min → 10 + 4×6 + 1 fração = 36,00
    await receber(id2, { forma: 'DINHEIRO', valorCentavos: 1000, valorRecebidoCentavos: 2000 }).expect(201);
    const dobro = await receber(id2, { forma: 'DINHEIRO', valorCentavos: 1000 }).expect(409);
    expect(dobro.body.erro.detalhes.motivo).toBe('POSSIVEL_DUPLICIDADE');
    expect(dobro.body.erro.mensagem).toMatch(/Já existe um pagamento de R\$\s10,00 em Dinheiro/);
    const ok = await receber(id2, {
      forma: 'DINHEIRO',
      valorCentavos: 1000,
      confirmarDuplicidade: true,
    }).expect(201);
    expect(ok.body.sessao.calculo).toMatchObject({ pagoCentavos: 2000, aPagarCentavos: 1600 });
  });

  it('duas telas recebendo o valor todo ao mesmo tempo: só uma recebe', async () => {
    const id3 = await ticketHa(2 * 60 * MIN + 20);
    const r = await Promise.all([
      receber(id3, { forma: 'PIX', valorCentavos: null }),
      receber(id3, { forma: 'CREDITO', valorCentavos: null }),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 422]);
    expect(await pagamentosDo(id3)).toBe(1);
  });

  it('na saída só cobra a diferença; troco no dinheiro', async () => {
    const s = (await admin.get(`/api/v1/sessoes/${id}`).expect(200)).body;
    const saida = await admin
      .post(`/api/v1/sessoes/${id}/saida`)
      .send({
        valorEsperadoCentavos: s.calculo.valorCalculadoCentavos,
        pagamentos: [
          {
            forma: 'DINHEIRO',
            valorCentavos: null,
            valorRecebidoCentavos: 500,
            chaveIdempotencia: randomUUID(),
          },
        ],
      })
      .expect(200);
    expect(saida.body.trocoTotalCentavos).toBe(300);
    expect(
      saida.body.sessao.pagamentos.map((p: { forma: string; valorCentavos: number }) => [
        p.forma,
        p.valorCentavos,
      ]),
    ).toEqual([
      ['PIX', 1400],
      ['DINHEIRO', 200],
    ]);
  });
});

describe('saída: reenvio da mesma operação', () => {
  it('reenviar a saída já registrada devolve o mesmo recibo, sem duplicar', async () => {
    const id = await ticketHa(70 * MIN + 20); // 71 min → 12,00
    const corpo = {
      valorEsperadoCentavos: 1200,
      pagamentos: [
        {
          forma: 'DINHEIRO',
          valorCentavos: null,
          valorRecebidoCentavos: 2000,
          chaveIdempotencia: randomUUID(),
        },
      ],
    };
    const a = await admin.post(`/api/v1/sessoes/${id}/saida`).send(corpo).expect(200);
    const b = await admin.post(`/api/v1/sessoes/${id}/saida`).send(corpo).expect(200);
    expect(b.body).toMatchObject({ repetido: true, trocoTotalCentavos: 800 });
    expect(b.body.sessao.valorFinalCentavos).toBe(a.body.sessao.valorFinalCentavos);
    expect(await pagamentosDo(id)).toBe(1);
    // A mesma chave não pode ser usada em outro ticket
    const outro = await ticketHa(70 * MIN + 20);
    const r = await admin.post(`/api/v1/sessoes/${outro}/saida`).send(corpo).expect(409);
    expect(r.body.erro.detalhes.motivo).toBe('CHAVE_REUTILIZADA');
  });
});

describe('estorno', () => {
  it('estorna pagamento de ticket aberto: sai do caixa e volta a ficar pendente', async () => {
    const id = await ticketHa(80 * MIN + 20);
    const p = (await receber(id, { forma: 'CREDITO', valorCentavos: null }).expect(201))
      .body as ResultadoPagamento;
    const r = await admin
      .post(`/api/v1/financeiro/pagamentos/${p.pagamento.id}/estornar`)
      .send({ motivo: 'Lançado no cartão errado' })
      .expect(200);
    expect(r.body.calculo).toMatchObject({ pagoCentavos: 0, aPagarCentavos: 1400 });
    expect(r.body.pagamentos[0].status).toBe('ESTORNADO');
    const [[mov]] = await pool.query<RowDataPacket[]>(
      "SELECT tipo, direcao, valor_centavos, descricao FROM movimentacoes_financeiras WHERE pagamento_id = ? AND tipo = 'ESTORNO'",
      [p.pagamento.id],
    );
    expect(mov).toMatchObject({
      direcao: 'SAIDA',
      valor_centavos: 1400,
      descricao: 'Lançado no cartão errado',
    });
    const de2 = await admin
      .post(`/api/v1/financeiro/pagamentos/${p.pagamento.id}/estornar`)
      .send({ motivo: 'de novo' })
      .expect(409);
    expect(de2.body.erro.mensagem).toBe('Este pagamento já foi estornado.');
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT motivo FROM historico_atividades WHERE acao = 'pagamento.estornado' AND entidade_id = ?",
      [p.pagamento.id],
    );
    expect(h?.motivo).toBe('Lançado no cartão errado');
  });

  it('ticket encerrado: a conta está fechada, não estorna', async () => {
    const id = await ticketHa(70 * MIN + 20);
    const saida = await admin
      .post(`/api/v1/sessoes/${id}/saida`)
      .send({
        valorEsperadoCentavos: 1200,
        pagamentos: [{ forma: 'PIX', valorCentavos: 1200, chaveIdempotencia: randomUUID() }],
      })
      .expect(200);
    const r = await admin
      .post(`/api/v1/financeiro/pagamentos/${saida.body.sessao.pagamentos[0].id}/estornar`)
      .send({ motivo: 'teste' })
      .expect(422);
    expect(r.body.erro.mensagem).toMatch(/já foi encerrado: a conta está fechada/);
  });

  it('quem não tem permissão não estorna', async () => {
    const id = await ticketHa(80 * MIN + 20);
    const p = (await receber(id, { forma: 'PIX', valorCentavos: null }).expect(201))
      .body as ResultadoPagamento;
    await operador
      .post(`/api/v1/financeiro/pagamentos/${p.pagamento.id}/estornar`)
      .send({ motivo: 'teste' })
      .expect(403);
  });
});

describe('caixa: sangria, suprimento e movimentações', () => {
  it('suprimento e sangria entram no dinheiro esperado e no histórico', async () => {
    const antes = (await admin.get('/api/v1/caixa/atual').expect(200)).body.caixa
      .dinheiroEsperadoCentavos as number;
    await admin
      .post('/api/v1/caixa/movimentar')
      .send({ tipo: 'SUPRIMENTO', valorCentavos: 5000, descricao: 'Reforço de troco' })
      .expect(200);
    const grande = await admin
      .post('/api/v1/caixa/movimentar')
      .send({ tipo: 'SANGRIA', valorCentavos: antes + 5001, descricao: 'Depósito' })
      .expect(422);
    expect(grande.body.erro.mensagem).toMatch(/maior que o dinheiro do caixa/);
    const r = await admin
      .post('/api/v1/caixa/movimentar')
      .send({ tipo: 'SANGRIA', valorCentavos: 3000, descricao: 'Depósito no banco' })
      .expect(200);
    expect(r.body.dinheiroEsperadoCentavos).toBe(antes + 2000);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM historico_atividades WHERE acao IN ('caixa.sangria', 'caixa.suprimento')",
        [],
      ),
    ).toBe(2);
    await operador
      .post('/api/v1/caixa/movimentar')
      .send({ tipo: 'SANGRIA', valorCentavos: 100, descricao: 'x' })
      .expect(403);
  });

  it('o detalhe do caixa lista todas as movimentações e confere com o resumo por forma', async () => {
    const atual = (await admin.get('/api/v1/caixa/atual').expect(200)).body.caixa;
    const d = (await admin.get(`/api/v1/financeiro/caixas/${atual.id}`).expect(200)).body as CaixaDetalhe;
    expect(d.movimentacoes[0]).toMatchObject({ tipo: 'ABERTURA', valorCentavos: 10_000 });
    expect(d.movimentacoes.some((m) => m.tipo === 'SANGRIA' && m.descricao === 'Depósito no banco')).toBe(
      true,
    );
    for (const f of d.porForma) {
      const daForma = d.movimentacoes.filter((m) => m.forma === f.forma);
      const saldo = daForma.reduce(
        (t, m) => t + (m.direcao === 'ENTRADA' ? m.valorCentavos : -m.valorCentavos),
        0,
      );
      expect(saldo).toBe(f.saldoCentavos);
    }
    const dinheiro = d.porForma.find((f) => f.forma === 'DINHEIRO')!;
    expect(d.dinheiroEsperadoCentavos).toBe(dinheiro.saldoCentavos);
  });

  it('histórico de movimentações com filtros e totais', async () => {
    const todas = (await admin.get('/api/v1/financeiro/movimentacoes?limite=200').expect(200)).body;
    const est = (await admin.get('/api/v1/financeiro/movimentacoes?tipo=ESTORNO').expect(200)).body;
    expect(est.itens.every((m: { tipo: string }) => m.tipo === 'ESTORNO')).toBe(true);
    expect(est.totais.entradasCentavos).toBe(0);
    expect(todas.totais.entradasCentavos - todas.totais.saidasCentavos).toBe(
      todas.itens.reduce(
        (t: number, m: { direcao: string; valorCentavos: number }) =>
          t + (m.direcao === 'ENTRADA' ? m.valorCentavos : -m.valorCentavos),
        0,
      ),
    );
  });
});

describe('consultas: pendentes, pagamentos e resumo do dia', () => {
  it('pendentes: tickets abertos com valor a receber (parciais marcados)', async () => {
    const parcial = await ticketHa(3 * 60 * MIN + 20); // 181 min → 10 + 2×6 + 1 fração = 24,00
    await receber(parcial, { forma: 'PIX', valorCentavos: 1000 }).expect(201);
    await ticketHa(5 * MIN); // dentro da tolerância: não é pendente
    const p = (await admin.get('/api/v1/financeiro/pendentes').expect(200)).body as ListaPendencias;
    const item = p.itens.find((x) => x.sessaoId === parcial)!;
    expect(item).toMatchObject({
      valorAcumuladoCentavos: 2400,
      pagoCentavos: 1000,
      aPagarCentavos: 1400,
      parcial: true,
    });
    expect(p.itens.every((x) => x.aPagarCentavos > 0)).toBe(true);
    expect(p.totalCentavos).toBe(p.itens.reduce((t, x) => t + x.aPagarCentavos, 0));
    expect(p.quantidade).toBe(p.itens.length);
  });

  it('lista de pagamentos: concluídos, estornados, por forma e busca pela placa', async () => {
    const todos = (await admin.get('/api/v1/financeiro/pagamentos?limite=200').expect(200))
      .body as ListaPagamentos;
    const estornados = (await admin.get('/api/v1/financeiro/pagamentos?status=ESTORNADO').expect(200))
      .body as ListaPagamentos;
    const pix = (await admin.get('/api/v1/financeiro/pagamentos?forma=PIX&limite=200').expect(200))
      .body as ListaPagamentos;
    expect(todos.totais.quantidade).toBe(todos.itens.length);
    expect(todos.totais.confirmadosCentavos).toBe(
      todos.itens.filter((p) => p.status === 'CONFIRMADO').reduce((t, p) => t + p.valorCentavos, 0),
    );
    expect(estornados.itens.length).toBeGreaterThan(0);
    expect(estornados.itens.every((p) => p.status === 'ESTORNADO' && p.motivoEstorno)).toBe(true);
    expect(pix.itens.every((p) => p.forma === 'PIX')).toBe(true);
    const placa = todos.itens[0]!.placa;
    const busca = (await admin.get(`/api/v1/financeiro/pagamentos?busca=${placa}`).expect(200))
      .body as ListaPagamentos;
    expect(busca.itens.every((p) => p.placa === placa)).toBe(true);
    // Paginação
    const p1 = (await admin.get('/api/v1/financeiro/pagamentos?limite=2').expect(200))
      .body as ListaPagamentos;
    const p2 = (await admin.get('/api/v1/financeiro/pagamentos?limite=2&pagina=2').expect(200))
      .body as ListaPagamentos;
    expect(p1.proximaPagina).toBe(2);
    expect(p2.itens[0]!.id).not.toBe(p1.itens[0]!.id);
  });

  it('resumo do dia: totais conferem com pagamentos, estornos e movimentações', async () => {
    const r = (await admin.get('/api/v1/financeiro/resumo').expect(200)).body as ResumoFinanceiroDia;
    const todos = (await admin.get('/api/v1/financeiro/pagamentos?limite=200').expect(200))
      .body as ListaPagamentos;
    const estornos = (await admin.get('/api/v1/financeiro/movimentacoes?tipo=ESTORNO&limite=200').expect(200))
      .body;
    const recebimentos = (
      await admin.get('/api/v1/financeiro/movimentacoes?tipo=RECEBIMENTO&limite=200').expect(200)
    ).body;
    expect(r.quantidadePagamentos).toBe(todos.totais.quantidade);
    expect(r.recebidoCentavos).toBe(todos.totais.confirmadosCentavos + todos.totais.estornadosCentavos);
    expect(r.recebidoCentavos).toBe(recebimentos.totais.entradasCentavos);
    expect(r.estornadoCentavos).toBe(estornos.totais.saidasCentavos);
    expect(r.liquidoCentavos).toBe(r.recebidoCentavos - r.estornadoCentavos);
    expect(r.porForma.reduce((t, f) => t + f.recebidoCentavos, 0)).toBe(r.recebidoCentavos);
    expect(r.porForma.reduce((t, f) => t + f.quantidade, 0)).toBe(r.quantidadePagamentos);
    expect(r.porHora.reduce((t, h) => t + h.recebidoCentavos, 0)).toBe(r.recebidoCentavos);
    expect(r.trocoCentavos).toBeGreaterThan(0);
    expect(r.ticketsEncerrados).toBe(
      await contar("SELECT COUNT(*) AS n FROM sessoes_estacionamento WHERE status = 'ENCERRADA'", []),
    );
    const pend = (await admin.get('/api/v1/financeiro/pendentes').expect(200)).body as ListaPendencias;
    expect(r.pendentes).toEqual({ quantidade: pend.quantidade, totalCentavos: pend.totalCentavos });
    expect(r.caixas.length).toBeGreaterThan(0);
  });

  it('dia anterior sem movimento; data futura é recusada', async () => {
    const ontem = new Date(Date.now() - 3 * 3600_000 - 24 * 3600_000).toISOString().slice(0, 10);
    const r = (await admin.get(`/api/v1/financeiro/resumo?data=${ontem}`).expect(200))
      .body as ResumoFinanceiroDia;
    expect(r).toMatchObject({ recebidoCentavos: 0, quantidadePagamentos: 0, pendentes: null, caixas: [] });
    await admin.get('/api/v1/financeiro/resumo?data=2999-01-01').expect(400);
  });

  it('operador não vê o financeiro geral, só o próprio caixa', async () => {
    await operador.get('/api/v1/financeiro/resumo').expect(403);
    await operador.get('/api/v1/financeiro/pagamentos').expect(403);
    await operador.get('/api/v1/financeiro/pendentes').expect(200);
    const outro = (await admin.get('/api/v1/caixa/atual').expect(200)).body.caixa.id;
    await operador.get(`/api/v1/financeiro/caixas/${outro}`).expect(404);
    expect((await operador.get('/api/v1/financeiro/caixas').expect(200)).body.itens).toEqual([]);
  });
});

describe('fechamento de caixa', () => {
  it('operador fecha o próprio caixa; depois não recebe mais até abrir outro', async () => {
    await operador.post('/api/v1/caixa/abrir').send({ saldoInicialCentavos: 2000 }).expect(201);
    const id = await ticketHa(80 * MIN + 20, operador);
    await receber(
      id,
      { forma: 'DINHEIRO', valorCentavos: null, valorRecebidoCentavos: 2000 },
      operador,
    ).expect(201);
    // Conferência às cegas: antes de fechar, o operador não recebe o esperado
    const antes = (await operador.get('/api/v1/caixa/atual').expect(200)).body.caixa;
    expect(antes).toMatchObject({
      dinheiroEsperadoCentavos: null,
      recebidoPorForma: [],
      conferenciaOculta: true,
    });
    const f = await operador.post('/api/v1/caixa/fechar').send({ saldoContadoCentavos: 3300 }).expect(200);
    // ...nem depois: esperado e diferença ficam só para quem supervisiona
    expect(f.body).toMatchObject({
      contadoCentavos: 3300,
      esperadoCentavos: null,
      diferencaCentavos: null,
      conferenciaOculta: true,
    });
    const [[gravado]] = await pool.query<RowDataPacket[]>(
      'SELECT saldo_esperado_centavos, saldo_contado_centavos, diferenca_centavos, fechado_por FROM caixa_sessoes WHERE id = ?',
      [f.body.caixaId],
    );
    expect(gravado).toMatchObject({
      saldo_esperado_centavos: 3400,
      saldo_contado_centavos: 3300,
      diferenca_centavos: -100,
    });
    // O gerente/administrador vê o resultado da conferência
    const visto = (await admin.get(`/api/v1/financeiro/caixas/${f.body.caixaId}`).expect(200)).body;
    expect(visto).toMatchObject({ dinheiroEsperadoCentavos: 3400, diferencaCentavos: -100 });
    const r = await receber(
      await ticketHa(80 * MIN + 20, operador),
      { forma: 'PIX', valorCentavos: null },
      operador,
    ).expect(422);
    expect(r.body.erro.detalhes.acao).toBe('ABRIR_CAIXA');
    const meus = (await operador.get('/api/v1/financeiro/caixas').expect(200)).body.itens;
    expect(meus[0]).toMatchObject({
      status: 'FECHADO',
      saldoContadoCentavos: 3300,
      dinheiroEsperadoCentavos: null,
      diferencaCentavos: null,
      recebidoCentavos: null,
      porForma: [],
      conferenciaOculta: true,
    });
    const detalhe = (await operador.get(`/api/v1/financeiro/caixas/${f.body.caixaId}`).expect(200)).body;
    expect(detalhe).toMatchObject({ dinheiroEsperadoCentavos: null, diferencaCentavos: null });
    // O valor informado não pode ser alterado depois (nem direto no banco pelo caminho do caixa)
    await operador.post('/api/v1/caixa/fechar').send({ saldoContadoCentavos: 3400 }).expect(422);
  });

  it('supervisor fecha o caixa esquecido de outro operador, com a diferença explicada', async () => {
    await operador.post('/api/v1/caixa/abrir').send({ saldoInicialCentavos: 1000 }).expect(201);
    const cx = (await operador.get('/api/v1/caixa/atual').expect(200)).body.caixa.id;
    await operador
      .post(`/api/v1/financeiro/caixas/${cx}/fechar`)
      .send({ saldoContadoCentavos: 1000 })
      .expect(403);
    const semMotivo = await admin
      .post(`/api/v1/financeiro/caixas/${cx}/fechar`)
      .send({ saldoContadoCentavos: 900 })
      .expect(400);
    expect(semMotivo.body.erro.mensagem).toMatch(/Explique na observação/);
    const r = await admin
      .post(`/api/v1/financeiro/caixas/${cx}/fechar`)
      .send({ saldoContadoCentavos: 900, observacao: 'Faltaram R$ 1,00 na contagem do supervisor' })
      .expect(200);
    expect(r.body.diferencaCentavos).toBe(-100);
    await admin
      .post(`/api/v1/financeiro/caixas/${cx}/fechar`)
      .send({ saldoContadoCentavos: 900 })
      .expect(409);
    expect((await operador.get('/api/v1/caixa/atual').expect(200)).body.caixa).toBeNull();
  });
});
