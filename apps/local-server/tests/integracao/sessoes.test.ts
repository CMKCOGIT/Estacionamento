import { createHash, randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ResultadoEntrada, SessaoDetalhe } from '@estacionamento/shared';
import { criarApp } from '../../src/app.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import { criarCadastrosBase, type CadastrosBase } from '../../src/modules/demonstracao/cenario.js';
import { ADMIN, criarUsuario, entrar, garantirAdmin } from './ajuda.js';

const app = criarApp();
const MIN = 60_000;
let admin: Awaited<ReturnType<typeof entrar>>;
let siteId: string;
let usuarioId: string;
let base: CadastrosBase;

const entrada = (corpo: Record<string, unknown>, agente = admin) =>
  agente.post('/api/v1/sessoes/entrada').send(corpo);
const localizar = (termo: string) =>
  admin.get(`/api/v1/sessoes/localizar?termo=${encodeURIComponent(termo)}`);
const pagamento = (forma: string, valorCentavos: number, extra: Record<string, unknown> = {}) => ({
  forma,
  valorCentavos,
  chaveIdempotencia: randomUUID(),
  ...extra,
});

/** Faz o ticket ter entrado há N minutos (para testar o cálculo). */
async function voltarNoTempo(sessaoId: string, minutos: number) {
  await pool.query('UPDATE sessoes_estacionamento SET entrada_em = NOW(3) - INTERVAL ? MINUTE WHERE id = ?', [
    minutos,
    sessaoId,
  ]);
}
async function estadoDaVaga(codigo: string) {
  const res = await admin.get('/api/v1/vagas?incluirRemovidas=true').expect(200);
  return res.body.itens.find((v: { codigo: string }) => v.codigo === codigo)?.estado;
}

beforeAll(async () => {
  ({ siteId, usuarioId } = await garantirAdmin());
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  await comTransacao({ usuarioId }, async (c) => {
    base = await criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 3,
      vagasMoto: 1,
      vigenteDesde: new Date(Date.now() - 10 * 24 * 60 * MIN),
    });
  });
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

describe('entrada', () => {
  let primeira: ResultadoEntrada;

  it('veículo novo: exige categoria', async () => {
    const res = await entrada({ placa: 'NOV1A11' }).expect(400);
    expect(res.body.erro.detalhes[0].campo).toBe('categoriaId');
  });

  it('cadastra o veículo, escolhe a primeira vaga livre, cria o ticket e o acesso do cliente', async () => {
    const res = await entrada({
      placa: 'nov-1a11',
      categoriaId: base.categorias.carro,
      cor: 'Branco',
    }).expect(201);
    primeira = res.body;
    expect(primeira.veiculoCadastradoAgora).toBe(true);
    expect(primeira.sessao).toMatchObject({
      placa: 'NOV1A11',
      status: 'ABERTA',
      vaga: 'A-01',
      categoria: 'Carro',
      modalidade: 'AVULSO',
      numero: '1',
      operadorEntrada: ADMIN.nome,
    });
    expect(Date.now() - new Date(primeira.sessao.entradaEm).getTime()).toBeLessThan(10_000);

    // Link individual: token depois do "#"; só o hash fica no banco
    const token = primeira.acesso.link.split('#')[1]!;
    expect(primeira.acesso.link).toMatch(/\/t#[A-Za-z0-9_-]{43}$/);
    expect(primeira.acesso.qrSvg).toMatch(/^<svg/);
    expect(primeira.acesso.mensagem).toContain('ticket nº 1');
    const [[t]] = await pool.query<RowDataPacket[]>(
      'SELECT HEX(token_hash) AS h FROM sessao_tokens WHERE sessao_id = ?',
      [primeira.sessao.id],
    );
    expect(t?.h).toBe(createHash('sha256').update(token).digest('hex').toUpperCase());

    // Vaga, histórico e sincronização acompanham
    expect(await estadoDaVaga('A-01')).toBe('OCUPADA');
    const [[ev]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM sync_outbox WHERE tipo = 'ticket.aberto' AND agregado_id = ?",
      [primeira.sessao.id],
    );
    expect(Number(ev?.n)).toBe(1);
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT usuario_id FROM historico_atividades WHERE acao = 'sessao.entrada' AND entidade_id = ?",
      [primeira.sessao.id],
    );
    expect(h?.usuario_id).toBe(usuarioId);
  });

  it('veículo já cadastrado é reconhecido pela placa (usa a categoria dele)', async () => {
    await admin
      .post('/api/v1/veiculos')
      .send({ placa: 'CAD2B22', categoriaId: base.categorias.carro, modelo: 'Gol' })
      .expect(201);
    const res = await entrada({ placa: 'CAD2B22' }).expect(201);
    expect(res.body).toMatchObject({ veiculoCadastradoAgora: false, sessao: { vaga: 'A-02', numero: '2' } });
  });

  it('ocupação duplicada: o mesmo veículo não entra duas vezes', async () => {
    const res = await entrada({ placa: 'NOV1A11' }).expect(422);
    expect(res.body.erro.mensagem).toMatch(
      /^O veículo NOV1A11 já está estacionado na vaga A-01 desde .*ticket nº 1/,
    );
  });

  it('ocupação duplicada: vaga escolhida já ocupada, bloqueada ou de outra categoria', async () => {
    const ocupada = await entrada({
      placa: 'OUT3C33',
      categoriaId: base.categorias.carro,
      vagaId: base.vagas.carro[0],
    }).expect(409);
    expect(ocupada.body.erro.mensagem).toBe('A vaga A-01 já está ocupada pelo veículo NOV1A11.');
    const outra = await entrada({
      placa: 'OUT3C33',
      categoriaId: base.categorias.carro,
      vagaId: base.vagas.moto[0],
    }).expect(422);
    expect(outra.body.erro.mensagem).toBe('A vaga M-01 é de Moto, mas o veículo é Carro.');
    await admin.post(`/api/v1/vagas/${base.vagas.carro[2]}/bloquear`).send({ motivo: 'teste' }).expect(200);
    const bloq = await entrada({
      placa: 'OUT3C33',
      categoriaId: base.categorias.carro,
      vagaId: base.vagas.carro[2],
    }).expect(422);
    expect(bloq.body.erro.mensagem).toBe('A vaga A-03 está bloqueada.');
  });

  it('entrada sem vaga disponível é recusada (A-03 bloqueada, A-01 e A-02 ocupadas)', async () => {
    const res = await entrada({ placa: 'LOT4D44', categoriaId: base.categorias.carro }).expect(422);
    expect(res.body.erro.mensagem).toBe(
      'Não há vagas disponíveis para Carro. O estacionamento está lotado nessa categoria.',
    );
    const [[v]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM sessoes_estacionamento WHERE placa = 'LOT4D44'",
    );
    expect(Number(v?.n)).toBe(0);
    await admin.post(`/api/v1/vagas/${base.vagas.carro[2]}/liberar`).expect(200);
  });

  it('duas entradas simultâneas na última vaga: só uma entra', async () => {
    const r = await Promise.all([
      entrada({ placa: 'MOT5E55', categoriaId: base.categorias.moto }),
      entrada({ placa: 'MOT6F66', categoriaId: base.categorias.moto }),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual([201, 422]);
    expect(r.find((x) => x.status === 422)?.body.erro.mensagem).toMatch(/Não há vagas disponíveis para Moto/);
  });

  it('sem tarifa publicada para a categoria, não entra', async () => {
    const cats = await admin.post('/api/v1/categorias').send({ codigo: 'VAN', nome: 'Van' }).expect(201);
    const van = cats.body.itens.find((c: { codigo: string }) => c.codigo === 'VAN');
    await admin.post('/api/v1/vagas').send({ codigo: 'V-01', categoriaId: van.id }).expect(201);
    const res = await entrada({ placa: 'VAN7G77', categoriaId: van.id }).expect(422);
    expect(res.body.erro.mensagem).toMatch(/Não há tabela de tarifas publicada com preço para Van/);
  });

  it('placa inválida', async () => {
    await entrada({ placa: 'XX1', categoriaId: base.categorias.carro }).expect(400);
  });
});

describe('saída', () => {
  let s1: SessaoDetalhe;

  beforeAll(async () => {
    s1 = (await localizar('NOV1A11').expect(200)).body;
    await voltarNoTempo(s1.id, 140); // 2h20 = R$ 20,00 na tarifa de carro
  });

  it('localiza pela placa ou pelo número do ticket, com o valor calculado', async () => {
    const porPlaca = (await localizar('nov-1a11').expect(200)).body as SessaoDetalhe;
    const porNumero = (await localizar('nº 1').expect(200)).body as SessaoDetalhe;
    expect(porNumero.id).toBe(porPlaca.id);
    expect(porPlaca.calculo).toMatchObject({
      valorCalculadoCentavos: 2000,
      pagoCentavos: 0,
      aPagarCentavos: 2000,
    });
    expect(porPlaca.calculo.permanenciaMin).toBeGreaterThanOrEqual(140);
    expect(porPlaca.calculo.tarifa).toMatch(/^1ª hora R\$\s10,00 · hora adicional R\$\s6,00/);
  });

  it('saída de veículo sem ticket: placa que nunca entrou', async () => {
    const res = await localizar('ZZZ9Z99').expect(404);
    expect(res.body.erro.mensagem).toBe('Não há nenhum ticket para a placa ZZZ9Z99.');
    await localizar('99999').expect(404);
  });

  it('sem caixa aberto, a tela é orientada a abrir o caixa', async () => {
    const res = await admin
      .post(`/api/v1/sessoes/${s1.id}/saida`)
      .send({ valorEsperadoCentavos: 2000, pagamentos: [pagamento('PIX', 2000)] })
      .expect(422);
    expect(res.body.erro.detalhes).toEqual({ acao: 'ABRIR_CAIXA' });
    const caixa = await admin.post('/api/v1/caixa/abrir').send({ saldoInicialCentavos: 5000 }).expect(201);
    expect(caixa.body).toMatchObject({
      posto: 'Guichê 1',
      saldoInicialCentavos: 5000,
      dinheiroEsperadoCentavos: 5000,
    });
  });

  it('confere o valor: se mudou desde a consulta, pede nova conferência', async () => {
    const res = await admin
      .post(`/api/v1/sessoes/${s1.id}/saida`)
      .send({ valorEsperadoCentavos: 1800, pagamentos: [pagamento('PIX', 1800)] })
      .expect(409);
    expect(res.body.erro).toMatchObject({ detalhes: { valorCalculadoCentavos: 2000 } });
  });

  it('pagamentos precisam somar exatamente o valor a pagar', async () => {
    const res = await admin
      .post(`/api/v1/sessoes/${s1.id}/saida`)
      .send({ valorEsperadoCentavos: 2000, pagamentos: [pagamento('PIX', 1500)] })
      .expect(422);
    expect(res.body.erro.mensagem).toMatch(/somam R\$\s15,00, mas o valor a pagar é R\$\s20,00/);
  });

  it('dinheiro com troco: encerra, libera a vaga e atualiza o caixa', async () => {
    const res = await admin
      .post(`/api/v1/sessoes/${s1.id}/saida`)
      .send({
        valorEsperadoCentavos: 2000,
        pagamentos: [pagamento('DINHEIRO', 2000, { valorRecebidoCentavos: 5000 })],
      })
      .expect(200);
    expect(res.body.trocoTotalCentavos).toBe(3000);
    expect(res.body.sessao).toMatchObject({
      status: 'ENCERRADA',
      valorFinalCentavos: 2000,
      operadorSaida: ADMIN.nome,
    });
    expect(res.body.sessao.pagamentos[0]).toMatchObject({
      forma: 'DINHEIRO',
      valorCentavos: 2000,
      valorRecebidoCentavos: 5000,
      trocoCentavos: 3000,
    });
    expect(await estadoDaVaga('A-01')).toBe('LIVRE');

    const caixa = (await admin.get('/api/v1/caixa/atual').expect(200)).body.caixa;
    expect(caixa.dinheiroEsperadoCentavos).toBe(7000); // 50 de troco inicial + 20 recebidos
    const [[tok]] = await pool.query<RowDataPacket[]>(
      'SELECT TIMESTAMPDIFF(HOUR, NOW(3), expira_em) AS h FROM sessao_tokens WHERE sessao_id = ?',
      [s1.id],
    );
    expect(Number(tok?.h)).toBeGreaterThanOrEqual(23); // link do cliente vale 24h após a saída
    const [[ev]] = await pool.query<RowDataPacket[]>(
      "SELECT payload->>'$.valor_final_centavos' AS v FROM sync_outbox WHERE tipo = 'ticket.fechado' AND agregado_id = ?",
      [s1.id],
    );
    expect(Number(ev?.v)).toBe(2000);
  });

  it('encerramento duplicado é recusado (e a placa já não tem ticket aberto)', async () => {
    const res = await admin
      .post(`/api/v1/sessoes/${s1.id}/saida`)
      .send({ valorEsperadoCentavos: 2000, pagamentos: [pagamento('PIX', 2000)] })
      .expect(409);
    expect(res.body.erro.mensagem).toMatch(
      /^O ticket nº 1 \(NOV1A11\) já foi encerrado em .* Não é possível registrar a saída de novo\./,
    );
    const busca = (await localizar('NOV1A11').expect(200)).body as SessaoDetalhe;
    expect(busca.status).toBe('ENCERRADA'); // a tela mostra "já saiu" em vez de oferecer nova saída
    const [[p]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM pagamentos WHERE sessao_id = ? AND status = 'CONFIRMADO'",
      [s1.id],
    );
    expect(Number(p?.n)).toBe(1);
  });

  it('duas saídas simultâneas do mesmo ticket: só uma encerra e só um pagamento é registrado', async () => {
    const s2 = (await localizar('CAD2B22').expect(200)).body as SessaoDetalhe;
    await voltarNoTempo(s2.id, 61); // 1h01 = R$ 12,00
    const corpo = () => ({ valorEsperadoCentavos: 1200, pagamentos: [pagamento('PIX', 1200)] });
    const r = await Promise.all([
      admin.post(`/api/v1/sessoes/${s2.id}/saida`).send(corpo()),
      admin.post(`/api/v1/sessoes/${s2.id}/saida`).send(corpo()),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
    const [[p]] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM pagamentos WHERE sessao_id = ?',
      [s2.id],
    );
    expect(Number(p?.n)).toBe(1);
  });

  it('pagamento dividido (Pix + débito) e dentro da tolerância sem cobrança', async () => {
    const e = (await entrada({ placa: 'DIV8H88', categoriaId: base.categorias.carro }).expect(201))
      .body as ResultadoEntrada;
    // Dentro da tolerância (10 min): sai sem pagar
    expect(e.sessao.calculo.aPagarCentavos).toBe(0);
    // Minutos são arredondados para cima: 110 min fica longe da virada de fração (1h50 = R$ 16,00)
    await voltarNoTempo(e.sessao.id, 110);
    const r = await admin
      .post(`/api/v1/sessoes/${e.sessao.id}/saida`)
      .send({
        valorEsperadoCentavos: 1600,
        pagamentos: [pagamento('PIX', 1000), pagamento('DEBITO', 600, { autorizacao: 'NSU123' })],
      })
      .expect(200);
    expect(r.body.sessao.pagamentos.map((p: { forma: string }) => p.forma)).toEqual(['PIX', 'DEBITO']);
    const tol = (await entrada({ placa: 'TOL9I99', categoriaId: base.categorias.carro }).expect(201))
      .body as ResultadoEntrada;
    await admin
      .post(`/api/v1/sessoes/${tol.sessao.id}/saida`)
      .send({ valorEsperadoCentavos: 0, pagamentos: [] })
      .expect(200);
  });

  it('troco só em dinheiro; desconto exige permissão e motivo', async () => {
    const e = (await entrada({ placa: 'DES1J11', categoriaId: base.categorias.carro }).expect(201))
      .body as ResultadoEntrada;
    await voltarNoTempo(e.sessao.id, 50); // dentro da 1ª hora = R$ 10,00
    await admin
      .post(`/api/v1/sessoes/${e.sessao.id}/saida`)
      .send({
        valorEsperadoCentavos: 1000,
        pagamentos: [pagamento('PIX', 1000, { valorRecebidoCentavos: 2000 })],
      })
      .expect(400);
    await admin
      .post(`/api/v1/sessoes/${e.sessao.id}/saida`)
      .send({ valorEsperadoCentavos: 1000, descontoCentavos: 500, pagamentos: [pagamento('PIX', 500)] })
      .expect(400);
    const ok = await admin
      .post(`/api/v1/sessoes/${e.sessao.id}/saida`)
      .send({
        valorEsperadoCentavos: 1000,
        descontoCentavos: 500,
        motivoAjuste: 'Cliente mensalista em teste',
        pagamentos: [pagamento('PIX', 500)],
      })
      .expect(200);
    expect(ok.body.sessao.valorFinalCentavos).toBe(500);
  });
});

describe('cancelamento e novo link do cliente', () => {
  it('cancela uma entrada errada e libera a vaga; cancelar de novo é recusado', async () => {
    const e = (await entrada({ placa: 'ERR2K22', categoriaId: base.categorias.carro }).expect(201))
      .body as ResultadoEntrada;
    const novo = await admin.post(`/api/v1/sessoes/${e.sessao.id}/novo-link`).expect(200);
    expect(novo.body.link).not.toBe(e.acesso.link);
    const [tokens] = await pool.query<RowDataPacket[]>(
      'SELECT revogado_em FROM sessao_tokens WHERE sessao_id = ? ORDER BY criado_em',
      [e.sessao.id],
    );
    expect(tokens.map((t) => t.revogado_em !== null)).toEqual([true, false]);

    await admin
      .post(`/api/v1/sessoes/${e.sessao.id}/cancelar`)
      .send({ motivo: 'Placa digitada errada' })
      .expect(200);
    expect(await estadoDaVaga(e.sessao.vaga!)).toBe('LIVRE');
    await admin.post(`/api/v1/sessoes/${e.sessao.id}/cancelar`).send({ motivo: 'de novo' }).expect(409);
    await admin
      .post(`/api/v1/sessoes/${e.sessao.id}/saida`)
      .send({ valorEsperadoCentavos: 0, pagamentos: [] })
      .expect(409);
  });
});

describe('política de encerramento do link do cliente', () => {
  const saidaSemCobranca = async (placa: string) => {
    const e = (await entrada({ placa, categoriaId: base.categorias.carro }).expect(201))
      .body as ResultadoEntrada;
    await admin
      .post(`/api/v1/sessoes/${e.sessao.id}/saida`)
      .send({ valorEsperadoCentavos: 0, pagamentos: [] })
      .expect(200);
    const [[t]] = await pool.query<RowDataPacket[]>(
      'SELECT TIMESTAMPDIFF(SECOND, NOW(3), expira_em) AS s FROM sessao_tokens WHERE sessao_id = ? AND revogado_em IS NULL',
      [e.sessao.id],
    );
    return Number(t?.s);
  };

  it('padrão 24h; o administrador altera e a próxima saída segue a nova política', async () => {
    expect((await admin.get('/api/v1/configuracoes/acesso-cliente').expect(200)).body).toEqual({
      horasAposSaida: 24,
    });
    await admin.put('/api/v1/configuracoes/acesso-cliente').send({ horasAposSaida: 2 }).expect(200);
    const s2h = await saidaSemCobranca('POL2H22');
    expect(s2h).toBeGreaterThan(2 * 3600 - 60);
    expect(s2h).toBeLessThanOrEqual(2 * 3600);

    // 0 = o acesso termina na saída
    await admin.put('/api/v1/configuracoes/acesso-cliente').send({ horasAposSaida: 0 }).expect(200);
    expect(await saidaSemCobranca('POL0H00')).toBeLessThanOrEqual(0);

    await admin.put('/api/v1/configuracoes/acesso-cliente').send({ horasAposSaida: 500 }).expect(400);
    await admin.put('/api/v1/configuracoes/acesso-cliente').send({ horasAposSaida: 1.5 }).expect(400);
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM historico_atividades WHERE acao = 'config.alterada' AND entidade_id = 'acesso_cliente'",
    );
    expect(Number(h?.n)).toBeGreaterThanOrEqual(1); // alteração auditada
    await admin.put('/api/v1/configuracoes/acesso-cliente').send({ horasAposSaida: 24 }).expect(200);
  });

  it('só quem gerencia configurações altera a política', async () => {
    await criarUsuario({ login: 'caixa-pol', senha: 'Senha12345', permissoes: ['sessao.saida'] });
    const caixa = await entrar(app, 'caixa-pol', 'Senha12345');
    await caixa.get('/api/v1/configuracoes/acesso-cliente').expect(403);
    await caixa.put('/api/v1/configuracoes/acesso-cliente').send({ horasAposSaida: 1 }).expect(403);
  });
});

describe('caixa e permissões', () => {
  it('fechar o caixa com diferença exige explicação', async () => {
    const atual = (await admin.get('/api/v1/caixa/atual')).body.caixa;
    await admin
      .post('/api/v1/caixa/fechar')
      .send({ saldoContadoCentavos: atual.dinheiroEsperadoCentavos - 100 })
      .expect(400);
    const r = await admin
      .post('/api/v1/caixa/fechar')
      .send({ saldoContadoCentavos: atual.dinheiroEsperadoCentavos - 100, observacao: 'Faltou R$ 1,00' })
      .expect(200);
    expect(r.body.diferencaCentavos).toBe(-100);
    expect((await admin.get('/api/v1/caixa/atual')).body.caixa).toBeNull();
  });

  it('quem só registra entrada não registra saída', async () => {
    await criarUsuario({ login: 'portaria', senha: 'Senha12345', permissoes: ['sessao.entrada'] });
    const portaria = await entrar(app, 'portaria', 'Senha12345');
    const e = await entrada({ placa: 'POR3L33', categoriaId: base.categorias.carro }, portaria).expect(201);
    await portaria
      .post(`/api/v1/sessoes/${e.body.sessao.id}/saida`)
      .send({ valorEsperadoCentavos: 0, pagamentos: [] })
      .expect(403);
  });
});
