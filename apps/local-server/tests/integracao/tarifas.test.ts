import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DadosRegra, PainelTarifas, SessaoDetalhe, TabelaTarifaDetalhe } from '@estacionamento/shared';
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

const painel = async () => (await admin.get('/api/v1/tarifas').expect(200)).body as PainelTarifas;
const entrada = (corpo: Record<string, unknown>) => admin.post('/api/v1/sessoes/entrada').send(corpo);
const voltarNoTempo = (sessaoId: string, minutos: number) =>
  pool.query('UPDATE sessoes_estacionamento SET entrada_em = NOW(3) - INTERVAL ? MINUTE WHERE id = ?', [
    minutos,
    sessaoId,
  ]);

function regra(extra: Partial<DadosRegra> = {}): DadosRegra {
  return {
    categoriaId: base.categorias.carro,
    tipo: 'PADRAO',
    nome: null,
    aplicacao: null,
    diasSemana: null,
    horaInicio: null,
    horaFim: null,
    ativo: true,
    toleranciaMin: 10,
    primeiraHoraCentavos: 1200,
    horaAdicionalCentavos: 800,
    fracaoMin: 15,
    fracaoCentavos: 300,
    carenciaMin: 5,
    diariaMaximaCentavos: 5000,
    diariaCentavos: 4500,
    valorFixoCentavos: null,
    ...extra,
  };
}

/** Janela "HH:MM–HH:MM" em volta de agora, no fuso do estacionamento (-03:00). */
function janelaAgora(): { horaInicio: string; horaFim: string } {
  const local = new Date(Date.now() - 3 * 60 * MIN);
  const m = local.getUTCHours() * 60 + local.getUTCMinutes();
  const fmt = (x: number) => {
    const v = (x + 1440) % 1440;
    return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  };
  return { horaInicio: fmt(m - 60), horaFim: fmt(m + 60) };
}

beforeAll(async () => {
  ({ siteId, usuarioId } = await garantirAdmin());
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  await comTransacao({ usuarioId }, async (c) => {
    base = await criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 6,
      vagasMoto: 2,
      vigenteDesde: new Date(Date.now() - 10 * 24 * 60 * MIN),
    });
  });
  await admin.post('/api/v1/caixa/abrir').send({ saldoInicialCentavos: 0 }).expect(201);
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

let v1: TabelaTarifaDetalhe;
let rascunho: TabelaTarifaDetalhe;
let ticketAntigo: SessaoDetalhe;

describe('consulta e permissões', () => {
  it('mostra a tabela vigente com a regra padrão de cada categoria', async () => {
    const p = await painel();
    v1 = p.vigente!;
    expect(v1).toMatchObject({ versao: 1, status: 'PUBLICADA', situacao: 'VIGENTE' });
    expect(v1.regras.map((r) => [r.categoria, r.tipo])).toEqual([
      ['Carro', 'PADRAO'],
      ['Moto', 'PADRAO'],
    ]);
    expect(p.rascunho).toBeNull();
  });

  it('funcionário só consulta: não cria nem publica versões', async () => {
    await criarUsuario({ login: 'func.tarifa', senha: 'Painel2026x', perfil: 'funcionario' });
    const func = await entrar(app, 'func.tarifa', 'Painel2026x');
    await func.get('/api/v1/tarifas').expect(200);
    await func.post('/api/v1/tarifas').send({}).expect(403);
    await func.post(`/api/v1/tarifas/${v1.id}/publicar`).send({}).expect(403);
  });
});

describe('a versão publicada é imutável (protege as cobranças)', () => {
  it('ticket aberto com a v1 antes da mudança de preço', async () => {
    const r = await entrada({ placa: 'ANT1A11', categoriaId: base.categorias.carro }).expect(201);
    ticketAntigo = r.body.sessao;
    expect(ticketAntigo.tarifaAplicada).toEqual({ nome: 'Padrão', tabelaVersao: 1, tipo: 'PADRAO' });
    const [[s]] = await pool.query<RowDataPacket[]>(
      'SELECT tarifa_aplicada FROM sessoes_estacionamento WHERE id = ?',
      [ticketAntigo.id],
    );
    expect(s?.tarifa_aplicada).toMatchObject({
      tabelaVersao: 1,
      selecao: 'PADRAO',
      regra: { primeiraHoraCentavos: 1000, horaAdicionalCentavos: 600, fracaoMin: 15, carenciaMin: 0 },
    });
  });

  it('não edita regra da versão publicada, nem pela API nem direto no banco', async () => {
    const carro = v1.regras[0]!;
    const res = await admin.put(`/api/v1/tarifas/${v1.id}/regras/${carro.id}`).send(regra()).expect(422);
    expect(res.body.erro.mensagem).toMatch(/já foi publicada e não pode ser alterada/);
    await expect(
      pool.query('UPDATE tarifa_regras SET primeira_hora_centavos = 1 WHERE id = ?', [carro.id]),
    ).rejects.toThrow(/imutáveis/);
    await expect(pool.query('DELETE FROM tarifa_regras WHERE id = ?', [carro.id])).rejects.toThrow(
      /não podem ser excluídas/,
    );
  });

  it('a tarifa gravada no ticket não pode ser trocada', async () => {
    await expect(
      pool.query("UPDATE sessoes_estacionamento SET tarifa_aplicada = JSON_OBJECT('x', 1) WHERE id = ?", [
        ticketAntigo.id,
      ]),
    ).rejects.toThrow(/não pode ser alterada/);
  });
});

describe('nova versão (cadastrar, editar, desativar)', () => {
  it('cria o rascunho copiando a vigente; só um rascunho por vez', async () => {
    const r = await admin.post('/api/v1/tarifas').send({ nome: 'Reajuste de dezembro' }).expect(201);
    rascunho = r.body;
    expect(rascunho).toMatchObject({
      versao: 2,
      status: 'RASCUNHO',
      nome: 'Reajuste de dezembro',
      descricao: 'Baseada na versão 1',
    });
    expect(rascunho.regras).toHaveLength(2);
    expect(rascunho.regras[0]!.id).not.toBe(v1.regras[0]!.id);
    const dup = await admin.post('/api/v1/tarifas').send({}).expect(409);
    expect(dup.body.erro.mensagem).toMatch(/Já existe uma versão em edição/);
  });

  it('edita o preço e a regra de arredondamento da padrão', async () => {
    const carro = rascunho.regras.find((r) => r.categoria === 'Carro')!;
    const r = await admin.put(`/api/v1/tarifas/${rascunho.id}/regras/${carro.id}`).send(regra()).expect(200);
    expect(r.body.regras[0]).toMatchObject({ primeiraHoraCentavos: 1200, carenciaMin: 5 });
  });

  it('valida as regras antes de salvar', async () => {
    const url = `/api/v1/tarifas/${rascunho.id}/regras`;
    const carencia = await admin
      .post(url)
      .send(regra({ tipo: 'ESPECIAL', nome: 'X', aplicacao: 'MANUAL', carenciaMin: 15 }))
      .expect(400);
    expect(carencia.body.erro.mensagem).toMatch(/carência deve ser menor/);
    const semNome = await admin
      .post(url)
      .send(regra({ tipo: 'ESPECIAL', aplicacao: 'MANUAL' }))
      .expect(400);
    expect(semNome.body.erro.mensagem).toMatch(/Dê um nome/);
    const semCondicao = await admin
      .post(url)
      .send(regra({ tipo: 'ESPECIAL', nome: 'Y', aplicacao: 'AUTOMATICA' }))
      .expect(400);
    expect(semCondicao.body.erro.mensagem).toMatch(/dias da semana ou de um horário/);
    const duasPadrao = await admin.post(url).send(regra()).expect(409);
    expect(duasPadrao.body.erro.mensagem).toMatch(/já tem tarifa padrão/);
  });

  it('cadastra tarifas especiais: automática (horário) e escolhida pelo operador', async () => {
    const url = `/api/v1/tarifas/${rascunho.id}/regras`;
    await admin
      .post(url)
      .send(
        regra({
          tipo: 'ESPECIAL',
          nome: 'Promoção do horário',
          aplicacao: 'AUTOMATICA',
          ...janelaAgora(),
          valorFixoCentavos: 1500,
          toleranciaMin: 0,
        }),
      )
      .expect(201);
    const r = await admin
      .post(url)
      .send(
        regra({
          tipo: 'ESPECIAL',
          nome: 'Convênio Farmácia',
          aplicacao: 'MANUAL',
          primeiraHoraCentavos: 500,
          carenciaMin: 0,
        }),
      )
      .expect(201);
    rascunho = r.body;
    expect(rascunho.regras.map((x) => x.nome ?? x.tipo)).toEqual([
      'PADRAO',
      'Promoção do horário',
      'Convênio Farmácia',
      'PADRAO',
    ]);
  });

  it('não publica com data no passado nem sem preço para categoria com vagas', async () => {
    const passado = await admin
      .post(`/api/v1/tarifas/${rascunho.id}/publicar`)
      .send({ vigenteDesde: new Date(Date.now() - 60 * MIN).toISOString() })
      .expect(422);
    expect(passado.body.erro.mensagem).toMatch(/não pode estar no passado/);

    const moto = rascunho.regras.find((r) => r.categoria === 'Moto')!;
    await admin
      .put(`/api/v1/tarifas/${rascunho.id}/regras/${moto.id}`)
      .send({ ...moto, ativo: false })
      .expect(200);
    const semMoto = await admin.post(`/api/v1/tarifas/${rascunho.id}/publicar`).send({}).expect(422);
    expect(semMoto.body.erro.mensagem).toMatch(/Defina a tarifa padrão de Moto/);
    await admin
      .put(`/api/v1/tarifas/${rascunho.id}/regras/${moto.id}`)
      .send({ ...moto, ativo: true })
      .expect(200);
  });

  it('publica agora: v2 passa a valer, v1 fica no histórico', async () => {
    const r = await admin.post(`/api/v1/tarifas/${rascunho.id}/publicar`).send({}).expect(200);
    expect(r.body).toMatchObject({ versao: 2, situacao: 'VIGENTE' });
    const p = await painel();
    expect(p.vigente?.versao).toBe(2);
    expect(p.historico.map((t) => [t.versao, t.situacao])).toEqual([
      [2, 'VIGENTE'],
      [1, 'SUBSTITUIDA'],
    ]);
    expect(p.historico[1]!.ticketsUsaram).toBe(1);
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT JSON_LENGTH(dados_novos->'$.regras') AS n FROM historico_atividades WHERE acao = 'tarifa.publicada' AND entidade_id = ?",
      [rascunho.id],
    );
    expect(Number(h?.n)).toBe(4);
    const [[ev]] = await pool.query<RowDataPacket[]>(
      "SELECT payload FROM sync_outbox WHERE tipo = 'tarifa.publicada' AND agregado_id = ?",
      [rascunho.id],
    );
    expect(ev?.payload.regras).toHaveLength(4);
  });
});

describe('cobrança respeita a tarifa da entrada', () => {
  it('ticket aberto antes da mudança continua cobrado pela v1; o cálculo fica gravado', async () => {
    await voltarNoTempo(ticketAntigo.id, 110);
    const s = (await admin.get(`/api/v1/sessoes/${ticketAntigo.id}`).expect(200)).body as SessaoDetalhe;
    // v1: 1ª hora 10,00 + 50 min = 4 frações de 2,00 limitadas à hora adicional (6,00) = 16,00
    // (na v2 seria 12,00 + 3 frações de 3,00 = 21,00)
    expect(s.calculo.valorCalculadoCentavos).toBe(1600);
    expect(s.calculo.itens.map((i) => i.descricao)).toEqual([
      '1ª hora',
      'Fração de 15 min (limitada ao valor da hora adicional)',
    ]);

    await admin
      .post(`/api/v1/sessoes/${ticketAntigo.id}/saida`)
      .send({
        valorEsperadoCentavos: 1600,
        pagamentos: [{ forma: 'PIX', valorCentavos: 1600, chaveIdempotencia: randomUUID() }],
      })
      .expect(200);
    const [[l]] = await pool.query<RowDataPacket[]>(
      'SELECT calculo_detalhe, valor_final_centavos FROM sessoes_estacionamento WHERE id = ?',
      [ticketAntigo.id],
    );
    expect(l?.valor_final_centavos).toBe(1600);
    expect(l?.calculo_detalhe).toMatchObject({
      permanenciaMin: expect.any(Number),
      valorFinalCentavos: 1600,
      tarifa: { nome: 'Padrão', tabelaVersao: 1 },
      itens: [
        { descricao: '1ª hora', totalCentavos: 1000 },
        { quantidade: 4, totalCentavos: 600 },
      ],
    });
  });

  it('entrada nova usa a especial automática do horário', async () => {
    const opcoes = (
      await admin.get(`/api/v1/sessoes/tarifas?categoriaId=${base.categorias.carro}`).expect(200)
    ).body;
    expect(opcoes.tabela.versao).toBe(2);
    expect(opcoes.opcoes.map((o: { nome: string }) => o.nome)).toEqual([
      'Padrão',
      'Promoção do horário',
      'Convênio Farmácia',
    ]);
    const promo = opcoes.opcoes[1];
    expect(opcoes.automaticaId).toBe(promo.id);
    expect(promo.descricao).toMatch(/^Preço fixo R\$\s15,00 por 24h$/);

    const r = await entrada({ placa: 'NOV2B22', categoriaId: base.categorias.carro }).expect(201);
    expect(r.body.sessao.tarifaAplicada).toEqual({
      nome: 'Promoção do horário',
      tabelaVersao: 2,
      tipo: 'ESPECIAL',
    });
    await voltarNoTempo(r.body.sessao.id, 300);
    const s = (await admin.get(`/api/v1/sessoes/${r.body.sessao.id}`).expect(200)).body as SessaoDetalhe;
    expect(s.calculo.valorCalculadoCentavos).toBe(1500);
  });

  it('o operador escolhe a especial manual; diária pede tarifa com diária', async () => {
    const opcoes = (
      await admin.get(`/api/v1/sessoes/tarifas?categoriaId=${base.categorias.carro}`).expect(200)
    ).body;
    const convenio = opcoes.opcoes.find((o: { nome: string }) => o.nome === 'Convênio Farmácia');
    const r = await entrada({
      placa: 'CON3C33',
      categoriaId: base.categorias.carro,
      tarifaRegraId: convenio.id,
    }).expect(201);
    const [[l]] = await pool.query<RowDataPacket[]>(
      'SELECT tarifa_aplicada FROM sessoes_estacionamento WHERE id = ?',
      [r.body.sessao.id],
    );
    expect(l?.tarifa_aplicada).toMatchObject({
      selecao: 'ESPECIAL_MANUAL',
      nome: 'Convênio Farmácia',
      regra: { primeiraHoraCentavos: 500 },
    });

    // Diária não usa a especial automática: vai para a padrão (que tem diária)
    const d = await entrada({
      placa: 'DIA4D44',
      categoriaId: base.categorias.carro,
      modalidade: 'DIARIA',
    }).expect(201);
    expect(d.body.sessao.tarifaAplicada.nome).toBe('Padrão');
    expect(d.body.sessao.calculo.tarifa).toMatch(/^Diária R\$\s45,00 por 24h$/);

    const outra = await entrada({
      placa: 'OUT5E55',
      categoriaId: base.categorias.moto,
      tarifaRegraId: convenio.id,
    }).expect(422);
    expect(outra.body.erro.mensagem).toMatch(/não está disponível para Moto/);
  });
});

describe('agendamento, arquivamento e desativação', () => {
  let v3: TabelaTarifaDetalhe;

  it('agenda a próxima versão: a vigente continua valendo até a data', async () => {
    v3 = (await admin.post('/api/v1/tarifas').send({}).expect(201)).body;
    const promo = v3.regras.find((r) => r.nome === 'Promoção do horário')!;
    // Desativar: a promoção não entra na v3, mas continua registrada na v2
    await admin
      .put(`/api/v1/tarifas/${v3.id}/regras/${promo.id}`)
      .send({ ...promo, ativo: false })
      .expect(200);
    const amanha = new Date(Date.now() + 24 * 60 * MIN).toISOString();
    const r = await admin
      .post(`/api/v1/tarifas/${v3.id}/publicar`)
      .send({ vigenteDesde: amanha })
      .expect(200);
    expect(r.body.situacao).toBe('AGENDADA');
    const p = await painel();
    expect(p.vigente?.versao).toBe(2);
    expect(p.agendadas.map((t) => t.versao)).toEqual([3]);
  });

  it('cancela o agendamento arquivando; a vigente não pode ser arquivada', async () => {
    await admin.post(`/api/v1/tarifas/${v3.id}/arquivar`).send({}).expect(200);
    const p = await painel();
    const vig = await admin.post(`/api/v1/tarifas/${p.vigente!.id}/arquivar`).send({}).expect(422);
    expect(vig.body.erro.mensagem).toMatch(/é a que está valendo agora/);
    await expect(
      pool.query("UPDATE tabelas_tarifa SET status = 'ARQUIVADA', arquivado_em = NOW(3) WHERE id = ?", [
        p.vigente!.id,
      ]),
    ).rejects.toThrow(/vigente não pode ser arquivada/);
  });

  it('desativada e publicada, a especial deixa de ser oferecida na entrada', async () => {
    const v4 = (await admin.post('/api/v1/tarifas').send({}).expect(201)).body as TabelaTarifaDetalhe;
    const promo = v4.regras.find((r) => r.nome === 'Promoção do horário')!;
    await admin
      .put(`/api/v1/tarifas/${v4.id}/regras/${promo.id}`)
      .send({ ...promo, ativo: false })
      .expect(200);
    await admin.post(`/api/v1/tarifas/${v4.id}/publicar`).send({}).expect(200);
    const opcoes = (
      await admin.get(`/api/v1/sessoes/tarifas?categoriaId=${base.categorias.carro}`).expect(200)
    ).body;
    expect(opcoes.tabela.versao).toBe(4);
    expect(opcoes.opcoes.map((o: { nome: string }) => o.nome)).toEqual(['Padrão', 'Convênio Farmácia']);
    expect(opcoes.automaticaId).toBe(opcoes.opcoes[0].id);
  });

  it('rascunho pode ser descartado; regra nova só existe no rascunho', async () => {
    const v5 = (await admin.post('/api/v1/tarifas').send({}).expect(201)).body as TabelaTarifaDetalhe;
    const extra = v5.regras.find((r) => r.nome === 'Convênio Farmácia')!;
    const semConvenio = (await admin.delete(`/api/v1/tarifas/${v5.id}/regras/${extra.id}`).expect(200)).body;
    expect(semConvenio.regras.some((r: { nome: string }) => r.nome === 'Convênio Farmácia')).toBe(false);
    await admin.delete(`/api/v1/tarifas/${v5.id}`).expect(204);
    expect((await painel()).rascunho).toBeNull();
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM historico_atividades WHERE acao = 'tarifa.rascunho_excluido' AND entidade_id = ?",
      [v5.id],
    );
    expect(Number(h?.n)).toBe(1);
  });
});
