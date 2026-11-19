import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConsultaPlaca, ListaVeiculos, VeiculoDetalhe } from '@estacionamento/shared';
import { criarApp } from '../../src/app.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { traduzirErroMysql } from '../../src/http/erros-mysql.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import {
  abrirCaixa,
  cancelarSessao,
  criarCadastrosBase,
  registrarEntrada,
  registrarPagamento,
  registrarSaida,
  REGRA_CARRO,
  type CadastrosBase,
} from '../../src/modules/demonstracao/cenario.js';
import { exigirVeiculoForaDoEstacionamento } from '../../src/modules/veiculos/veiculos.service.js';
import { ADMIN, criarUsuario, entrar, garantirAdmin } from './ajuda.js';

const app = criarApp();
const MIN = 60_000;
let admin: Awaited<ReturnType<typeof entrar>>;
let siteId: string;
let usuarioId: string;
let base: CadastrosBase;
let caixa: string;

const API = '/api/v1/veiculos';

function entradaCarro(placa: string, vagaIndice: number, em: Date) {
  return comTransacao({ usuarioId }, (c) =>
    registrarEntrada(c, {
      siteId,
      placa,
      categoriaId: base.categorias.carro,
      vagaId: base.vagas.carro[vagaIndice]!,
      regraId: base.regras.carro,
      operadorId: usuarioId,
      postoId: base.postoId,
      em,
    }),
  );
}

beforeAll(async () => {
  ({ siteId, usuarioId } = await garantirAdmin());
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  const [[t]] = await pool.query<RowDataPacket[]>('SELECT NOW(3) AS agora');
  const agora = t?.agora as Date;
  await comTransacao({ usuarioId }, async (c) => {
    base = await criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 6,
      vagasMoto: 2,
      vigenteDesde: new Date(agora.getTime() - 30 * 24 * 60 * MIN),
    });
    caixa = await abrirCaixa(c, {
      siteId,
      postoId: base.postoId,
      operadorId: usuarioId,
      em: new Date(agora.getTime() - 10 * 24 * 60 * MIN),
      saldoInicial: 0,
    });
  });
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

describe('cadastro e identificação pela placa', () => {
  it('cadastra com a placa normalizada', async () => {
    const res = await admin
      .post(API)
      .send({
        placa: ' abc-1d23 ',
        categoriaId: base.categorias.carro,
        marca: ' Fiat ',
        modelo: 'Argo',
        cor: 'Prata',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      placa: 'ABC1D23',
      marca: 'Fiat',
      modelo: 'Argo',
      totalEstadias: 0,
      estadiaAtual: null,
    });
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT usuario_id FROM historico_atividades WHERE acao = 'veiculo.cadastrado' AND entidade_id = ?",
      [res.body.id],
    );
    expect(h?.usuario_id).toBe(usuarioId);
  });

  it('não duplica: a mesma placa escrita de outro jeito é recusada e o cadastro existente é indicado', async () => {
    const original = (await admin.get(`${API}/placa/ABC1D23`).expect(200)).body as ConsultaPlaca;
    const dup = await admin
      .post(API)
      .send({ placa: 'abc 1d23', categoriaId: base.categorias.carro })
      .expect(409);
    expect(dup.body.erro).toMatchObject({
      mensagem: 'Já existe um veículo cadastrado com a placa ABC1D23.',
      detalhes: { veiculoId: original.veiculo?.id },
    });
  });

  it.each([
    ['AB12345', false, 'placa'],
    ['ABCD123', false, 'placa'],
    ['A1', true, 'placa'],
  ])('placa inválida %s (estrangeira=%s) → 400', async (placa, estrangeira, campo) => {
    const res = await admin
      .post(API)
      .send({ placa, placaEstrangeira: estrangeira, categoriaId: base.categorias.carro })
      .expect(400);
    expect(res.body.erro.detalhes[0].campo).toBe(campo);
  });

  it('aceita padrão antigo e placa estrangeira (marcada)', async () => {
    await admin.post(API).send({ placa: 'XYZ-9876', categoriaId: base.categorias.carro }).expect(201);
    const ext = await admin
      .post(API)
      .send({ placa: 'AB 123 CD', placaEstrangeira: true, categoriaId: base.categorias.carro })
      .expect(201);
    expect(ext.body).toMatchObject({ placa: 'AB123CD', placaEstrangeira: true });
  });

  it('consulta por placa: encontrada, não cadastrada e inválida', async () => {
    const achou = (await admin.get(`${API}/placa/abc-1d23`).expect(200)).body as ConsultaPlaca;
    expect(achou).toMatchObject({ placa: 'ABC1D23', valida: true, veiculo: { modelo: 'Argo' } });
    expect((await admin.get(`${API}/placa/QWE1R23`).expect(200)).body).toEqual({
      placa: 'QWE1R23',
      valida: true,
      veiculo: null,
    });
    expect((await admin.get(`${API}/placa/12`).expect(200)).body).toMatchObject({
      valida: false,
      veiculo: null,
    });
  });
});

describe('estadias: um veículo, várias visitas', () => {
  let id: string;
  const agora = () => new Date();

  beforeAll(async () => {
    id = ((await admin.get(`${API}/placa/ABC1D23`)).body as ConsultaPlaca).veiculo!.id;
    // 1) Há 3 dias: 2h, pago no PIX
    const e1 = new Date(Date.now() - 3 * 24 * 60 * MIN);
    const s1 = await entradaCarro('ABC1D23', 0, e1);
    await comTransacao({ usuarioId }, (c) =>
      registrarSaida(c, {
        siteId,
        sessaoId: s1,
        regra: REGRA_CARRO,
        entradaEm: e1,
        em: new Date(e1.getTime() + 120 * MIN),
        caixaId: caixa,
        forma: 'PIX',
        operadorId: usuarioId,
        postoId: base.postoId,
      }),
    );
    // 2) Ontem: cancelada
    const s2 = await entradaCarro('ABC1D23', 1, new Date(Date.now() - 24 * 60 * MIN));
    await comTransacao({ usuarioId }, (c) =>
      cancelarSessao(c, {
        sessaoId: s2,
        em: new Date(Date.now() - 24 * 60 * MIN + MIN),
        operadorId: usuarioId,
        motivo: 'Entrada duplicada',
      }),
    );
    // 3) Agora: estacionado há 2h20, com R$ 5,00 adiantados
    const s3 = await entradaCarro('ABC1D23', 2, new Date(Date.now() - 140 * MIN));
    await comTransacao({ usuarioId }, (c) =>
      registrarPagamento(c, {
        siteId,
        sessaoId: s3,
        caixaId: caixa,
        forma: 'DINHEIRO',
        valor: 500,
        recebido: 500,
        operadorId: usuarioId,
        em: agora(),
      }),
    );
  });

  it('identifica o veículo estacionado agora, com vaga, tempo e valor em aberto', async () => {
    const v = (await admin.get(`${API}/${id}`).expect(200)).body as VeiculoDetalhe;
    expect(v.estadiaAtual).toMatchObject({ vaga: 'A-03', modalidade: 'AVULSO', pagoCentavos: 500 });
    expect(v.estadiaAtual!.permanenciaMin).toBeGreaterThanOrEqual(140);
    // 2h20 = R$ 20,00 (ou um pouco mais se o relógio virou a fração) − R$ 5,00 pago
    expect(v.estadiaAtual!.valorEstimadoCentavos).toBeGreaterThanOrEqual(1500);
  });

  it('estatísticas do veículo', async () => {
    const v = (await admin.get(`${API}/${id}`).expect(200)).body as VeiculoDetalhe;
    expect(v.estatisticas).toMatchObject({
      totalEstadias: 3,
      encerradas: 1,
      canceladas: 1,
      tempoTotalMin: 120,
      tempoMedioMin: 120,
      totalPagoCentavos: 1600 + 500,
    });
    expect(new Date(v.estatisticas.primeiraVisitaEm!).getTime()).toBeLessThan(Date.now() - 2 * 24 * 60 * MIN);
    expect(new Date(v.ultimaVisitaEm!).getTime()).toBeGreaterThan(Date.now() - 150 * MIN); // trigger atualizou
  });

  it('histórico de estadias, da mais recente para a mais antiga, com paginação', async () => {
    const p1 = await admin.get(`${API}/${id}/estadias?limite=2`).expect(200);
    expect(p1.body.itens.map((e: { status: string }) => e.status)).toEqual(['ABERTA', 'CANCELADA']);
    expect(p1.body.itens[1]).toMatchObject({ motivoCancelamento: 'Entrada duplicada', vaga: 'A-02' });
    expect(p1.body.proximaPagina).toBe('2');
    const p2 = await admin.get(`${API}/${id}/estadias?limite=2&pagina=2`).expect(200);
    expect(p2.body.itens[0]).toMatchObject({
      status: 'ENCERRADA',
      permanenciaMin: 120,
      valorFinalCentavos: 1600,
      pagoCentavos: 1600,
      operadorSaida: ADMIN.nome,
    });
    expect(p2.body.proximaPagina).toBeNull();
  });

  it('lista "estacionados agora"', async () => {
    const l = (await admin.get(`${API}?estacionados=true`).expect(200)).body as ListaVeiculos;
    expect(l.itens.map((v) => v.placa)).toEqual(['ABC1D23']);
    expect(l.estacionadosAgora).toBe(1);
    const todos = (await admin.get(API).expect(200)).body as ListaVeiculos;
    expect(todos.itens[0]?.placa).toBe('ABC1D23'); // estacionados primeiro
    expect(todos.total).toBe(3);
  });

  it('busca por placa parcial, marca ou modelo', async () => {
    expect(((await admin.get(`${API}?busca=1d2`)).body as ListaVeiculos).itens.map((v) => v.placa)).toEqual([
      'ABC1D23',
    ]);
    expect(((await admin.get(`${API}?busca=argo`)).body as ListaVeiculos).itens.map((v) => v.placa)).toEqual([
      'ABC1D23',
    ]);
  });
});

describe('regra: no máximo uma estadia aberta por veículo', () => {
  it('a regra explica onde o veículo está', async () => {
    const id = ((await admin.get(`${API}/placa/ABC1D23`)).body as ConsultaPlaca).veiculo!.id;
    const erro = await comTransacao({}, (c) => exigirVeiculoForaDoEstacionamento(c, id)).catch(
      (e: unknown) => e,
    );
    expect((erro as Error).message).toMatch(
      /^O veículo ABC1D23 já está estacionado na vaga A-03 desde .* \(ticket nº \d+\)\. Registre a saída/,
    );
  });

  it('o banco recusa a segunda entrada mesmo se alguém pular a regra', async () => {
    const erro = await entradaCarro('ABC1D23', 3, new Date()).catch((e: unknown) => e);
    expect(traduzirErroMysql(erro)).toMatchObject({
      status: 409,
      message: 'Este veículo já está estacionado.',
    });
  });

  it('e nem com duas entradas simultâneas em vagas diferentes', async () => {
    const r = await Promise.allSettled([
      entradaCarro('XYZ9876', 3, new Date()),
      entradaCarro('XYZ9876', 4, new Date()),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(
      traduzirErroMysql((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason)?.message,
    ).toBe('Este veículo já está estacionado.');
    const [[n]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM sessoes_estacionamento WHERE placa = 'XYZ9876' AND status = 'ABERTA'",
    );
    expect(Number(n?.n)).toBe(1);
  });

  it('o ticket sempre aponta para o veículo da mesma placa', async () => {
    const [[v]] = await pool.query<RowDataPacket[]>("SELECT id FROM veiculos WHERE placa = 'AB123CD'");
    const erro = await pool
      .query(
        `INSERT INTO sessoes_estacionamento (id, site_id, numero, veiculo_id, placa, categoria_id, vaga_id, tarifa_regra_id, entrada_em, operador_entrada_id)
         VALUES ('01JZZZZZZZZZZZZZZZZZZZZZZZ', ?, 99999, ?, 'OUT9R99', ?, ?, ?, NOW(3), ?)`,
        [siteId, v?.id, base.categorias.carro, base.vagas.carro[5], base.regras.carro, usuarioId],
      )
      .catch((e: unknown) => e);
    expect(traduzirErroMysql(erro)?.message).toBe('A placa do ticket não corresponde à placa do veículo');
  });
});

describe('edição preservando o histórico', () => {
  it('correção de placa: o ticket aberto acompanha; os antigos mantêm a placa da época', async () => {
    const id = ((await admin.get(`${API}/placa/ABC1D23`)).body as ConsultaPlaca).veiculo!.id;
    const res = await admin
      .patch(`${API}/${id}`)
      .send({
        placa: 'ABC1D24',
        categoriaId: base.categorias.carro,
        marca: 'Fiat',
        modelo: 'Argo Drive',
        cor: 'Prata',
        motivo: 'Placa digitada errada',
      })
      .expect(200);
    expect(res.body).toMatchObject({ placa: 'ABC1D24', modelo: 'Argo Drive' });

    const [sessoes] = await pool.query<RowDataPacket[]>(
      'SELECT placa, status FROM sessoes_estacionamento WHERE veiculo_id = ? ORDER BY entrada_em',
      [id],
    );
    expect(sessoes.map((s) => `${s.status}:${s.placa}`)).toEqual([
      'ENCERRADA:ABC1D23',
      'CANCELADA:ABC1D23',
      'ABERTA:ABC1D24',
    ]);
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT motivo, dados_anteriores->>'$.placa' AS antes FROM historico_atividades WHERE acao = 'veiculo.placa_corrigida' AND entidade_id = ?",
      [id],
    );
    expect(h).toMatchObject({ motivo: 'Placa digitada errada', antes: 'ABC1D23' });
    // A placa antiga ficou livre e o histórico continua no mesmo veículo
    expect(((await admin.get(`${API}/placa/ABC1D23`)).body as ConsultaPlaca).veiculo).toBeNull();
    expect(((await admin.get(`${API}/${id}/estadias`)).body.itens as unknown[]).length).toBe(3);
  });

  it('não permite corrigir para uma placa que já existe', async () => {
    const id = ((await admin.get(`${API}/placa/ABC1D24`)).body as ConsultaPlaca).veiculo!.id;
    const res = await admin
      .patch(`${API}/${id}`)
      .send({ placa: 'XYZ9876', categoriaId: base.categorias.carro })
      .expect(409);
    expect(res.body.erro.mensagem).toMatch(/Já existe um veículo cadastrado com a placa XYZ-9876/);
  });

  it('veículo com estadias não é excluído; sem estadias, pode', async () => {
    const id = ((await admin.get(`${API}/placa/ABC1D24`)).body as ConsultaPlaca).veiculo!.id;
    const negado = await admin.post(`${API}/${id}/remover`).send({ motivo: 'teste' }).expect(409);
    expect(negado.body.erro.mensagem).toMatch(/tem 3 estadia\(s\).*histórico precisa ser preservado/);
    const novo = await admin
      .post(API)
      .send({ placa: 'DEL1E11', categoriaId: base.categorias.carro })
      .expect(201);
    await admin.post(`${API}/${novo.body.id}/remover`).send({ motivo: 'Cadastro de teste' }).expect(200);
    await admin.get(`${API}/${novo.body.id}`).expect(404);
  });
});

describe('permissões', () => {
  it('quem só consulta não cadastra nem edita', async () => {
    await criarUsuario({ login: 'veic_leitor', senha: 'Senha12345', permissoes: ['sessao.consultar'] });
    const leitor = await entrar(app, 'veic_leitor', 'Senha12345');
    await leitor.get(`${API}/placa/ABC1D24`).expect(200);
    await leitor.post(API).send({ placa: 'LEI1T00', categoriaId: base.categorias.carro }).expect(403);
  });
});
