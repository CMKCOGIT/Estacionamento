import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { RowDataPacket } from 'mysql2/promise';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  formatarPlaca,
  type RelatorioTitular,
  type ResultadoEntrada,
  type SolicitacaoLgpd,
} from '@estacionamento/shared';
import { criarApp } from '../../src/app.js';
import { opcoesLogger } from '../../src/config/logger.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import { criarCadastrosBase, type CadastrosBase } from '../../src/modules/demonstracao/cenario.js';
import { privacidadeService } from '../../src/modules/privacidade/privacidade.service.js';
import { projecaoSite } from '../../src/sync/projecoes.js';
import { ADMIN, criarUsuario, entrar, garantirAdmin } from './ajuda.js';

const app = criarApp();
let admin: Awaited<ReturnType<typeof entrar>>;
let siteId: string;
let base: CadastrosBase;
const PLACA = 'LGP1D23';

const entrada = async (placa: string) =>
  (
    await admin
      .post('/api/v1/sessoes/entrada')
      .send({ placa, categoriaId: base.categorias.carro })
      .expect(201)
  ).body as ResultadoEntrada;
async function sair(id: string) {
  await pool.query(
    'UPDATE sessoes_estacionamento SET entrada_em = NOW(3) - INTERVAL 70 MINUTE WHERE id = ?',
    [id],
  );
  const s = (await admin.get(`/api/v1/sessoes/${id}`).expect(200)).body;
  await admin
    .post(`/api/v1/sessoes/${id}/saida`)
    .send({
      valorEsperadoCentavos: s.calculo.valorCalculadoCentavos,
      pagamentos: [{ forma: 'PIX', valorCentavos: null, chaveIdempotencia: randomUUID() }],
    })
    .expect(200);
}
const textoDe = async (sql: string, p: unknown[] = []) =>
  JSON.stringify((await pool.query<RowDataPacket[]>(sql, p))[0]);

beforeAll(async () => {
  let usuarioId: string;
  ({ siteId, usuarioId } = await garantirAdmin());
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  await comTransacao({ usuarioId }, async (c) => {
    base = await criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 6,
      vagasMoto: 1,
      vigenteDesde: new Date(Date.now() - 86_400_000),
    });
  });
  await admin.post('/api/v1/caixa/abrir').send({ saldoInicialCentavos: 0 }).expect(201);
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

describe('controle de acesso', () => {
  it('só quem tem lgpd.atender vê dados de titulares', async () => {
    await criarUsuario({
      login: 'caixa-lgpd',
      senha: 'Senha12345',
      permissoes: ['sessao.entrada', 'sessao.saida'],
    });
    const caixa = await entrar(app, 'caixa-lgpd', 'Senha12345');
    await caixa.get(`/api/v1/privacidade/titular?placa=${PLACA}`).expect(403);
    await caixa.post('/api/v1/privacidade/titular/anonimizar').send({ placa: PLACA }).expect(403);
    await caixa.get('/api/v1/privacidade/solicitacoes').expect(403);
  });
});

describe('direitos do titular', () => {
  let idTicket: string;

  it('acesso: relatório só com os dados do titular (sem operadores, IPs ou outros titulares)', async () => {
    const e = await entrada(PLACA);
    idTicket = e.sessao.id;
    await entrada('OUT9Z99');
    const r = (await admin.get(`/api/v1/privacidade/titular?placa=${PLACA}`).expect(200))
      .body as RelatorioTitular;
    expect(r.veiculo?.placa).toBe(formatarPlaca(PLACA));
    expect(r.estadias).toHaveLength(1);
    expect(r.emAndamento).toBe(true);
    expect(r.compartilhamento).toHaveLength(1); // no app do cliente enquanto o link vale
    expect(r.finalidades.length).toBeGreaterThan(0);
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/OUT9Z99|Ana Administradora|operador|127\.0\.0\.1|::ffff|token/i);
    // A consulta fica registrada, sem a placa
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT entidade_id FROM historico_atividades WHERE acao = 'lgpd.relatorio_titular' ORDER BY id DESC LIMIT 1",
    );
    expect(h?.entidade_id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('portabilidade: arquivo JSON para baixar', async () => {
    const r = await admin.get(`/api/v1/privacidade/titular/exportar?placa=${PLACA}`).expect(200);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="dados-titular-/);
    expect(JSON.parse(r.text).identificador.tipo).toBe('PLACA');
  });

  it('anonimização: recusada com o veículo no estacionamento; depois da saída, a placa some de tudo', async () => {
    await admin
      .post('/api/v1/privacidade/titular/anonimizar')
      .send({ placa: PLACA, motivo: 'LGPD-2026-0001', confirmacao: true })
      .expect(422);
    await sair(idTicket);
    const [[antes]] = await pool.query<RowDataPacket[]>(
      "SELECT SUM(valor_centavos) AS t FROM pagamentos WHERE status = 'CONFIRMADO'",
    );
    await admin
      .post('/api/v1/privacidade/titular/anonimizar')
      .send({ placa: PLACA, motivo: 'pedido' })
      .expect(400);
    const r = (
      await admin
        .post('/api/v1/privacidade/titular/anonimizar')
        .send({ placa: PLACA, motivo: 'LGPD-2026-0001', confirmacao: true })
        .expect(200)
    ).body;
    expect(r).toMatchObject({ estadias: 1, removidosDaNuvem: 1 });
    expect(r.registrosDeHistorico).toBeGreaterThan(0);

    for (const [tabela, coluna] of [
      ['veiculos', 'placa'],
      ['sessoes_estacionamento', 'placa'],
    ])
      expect(await textoDe(`SELECT ${coluna} FROM ${tabela}`)).not.toContain(PLACA);
    expect(
      await textoDe('SELECT dados_anteriores, dados_novos, motivo FROM historico_atividades'),
    ).not.toContain(PLACA);
    expect(await textoDe('SELECT payload FROM sync_outbox')).not.toContain(PLACA);
    // Link do cliente revogado e ticket retirado da nuvem
    expect(
      await textoDe('SELECT revogado_em FROM sessao_tokens WHERE sessao_id = ?', [idTicket]),
    ).not.toContain('null');
    const [[ev]] = await pool.query<RowDataPacket[]>(
      "SELECT payload FROM sync_outbox WHERE tipo = 'ticket.removido' AND agregado_id = ?",
      [idTicket],
    );
    expect(ev?.payload).toEqual({ tipo: 'ticket_removido', ticketId: idTicket });
    // Valores pagos continuam (obrigação fiscal)
    const [[depois]] = await pool.query<RowDataPacket[]>(
      "SELECT SUM(valor_centavos) AS t FROM pagamentos WHERE status = 'CONFIRMADO'",
    );
    expect(depois?.t).toEqual(antes?.t);
    await admin.get(`/api/v1/privacidade/titular?placa=${PLACA}`).expect(200); // nada mais ligado à placa
    const vazio = (await admin.get(`/api/v1/privacidade/titular?placa=${PLACA}`)).body as RelatorioTitular;
    expect(vazio.veiculo).toBeNull();
    expect(vazio.estadias).toHaveLength(0);
  });
});

describe('solicitações dos titulares', () => {
  it('protocolo, prazo de 15 dias, resposta obrigatória para concluir, sem reabrir', async () => {
    const s = (
      await admin
        .post('/api/v1/privacidade/solicitacoes')
        .send({
          tipo: 'CONFIRMACAO_ACESSO',
          titularNome: 'Maria',
          titularContato: 'maria@exemplo.com',
          placa: 'abc1d23',
        })
        .expect(201)
    ).body as SolicitacaoLgpd;
    expect(s.protocolo).toMatch(/^LGPD-\d{4}-\d{4}$/);
    const dias = (Date.parse(s.prazoEm) - Date.parse(s.recebidaEm)) / 86_400_000;
    expect(Math.round(dias)).toBe(15);
    expect(s.identificador).toBe(formatarPlaca('ABC1D23')); // normalizada
    await admin.patch(`/api/v1/privacidade/solicitacoes/${s.id}`).send({ status: 'ATENDIDA' }).expect(422);
    const ok = (
      await admin
        .patch(`/api/v1/privacidade/solicitacoes/${s.id}`)
        .send({ status: 'ATENDIDA', resposta: 'Relatório enviado por e-mail' })
        .expect(200)
    ).body as SolicitacaoLgpd;
    expect(ok).toMatchObject({ status: 'ATENDIDA', concluidaEm: expect.any(String) });
    await admin.patch(`/api/v1/privacidade/solicitacoes/${s.id}`).send({ status: 'ABERTA' }).expect(409);
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM historico_atividades WHERE acao LIKE 'lgpd.solicitacao_%' AND entidade_id = ?",
      [s.id],
    );
    expect(Number(h?.n)).toBe(2);
  });
});

describe('retenção', () => {
  it('anonimiza placas antigas, apaga acessos antigos ao painel e a identificação de solicitações concluídas', async () => {
    const e = await entrada('VEL1A11');
    await sair(e.sessao.id);
    await pool.query(
      "UPDATE veiculos SET ultima_visita_em = NOW(3) - INTERVAL 70 MONTH WHERE placa = 'VEL1A11'",
    );
    await pool.query(
      "UPDATE sessoes_acesso SET encerrada_em = NOW(3) - INTERVAL 400 DAY, motivo_encerramento = 'LOGOUT' WHERE encerrada_em IS NULL AND usuario_id <> (SELECT id FROM usuarios WHERE login = ?) LIMIT 1",
      [ADMIN.login],
    );
    await pool.query(
      'UPDATE lgpd_solicitacoes SET concluida_em = NOW(3) - INTERVAL 7 MONTH WHERE concluida_em IS NOT NULL',
    );
    const r = await privacidadeService.executarRetencao();
    expect(r.veiculosAnonimizados).toBe(1);
    expect(r.acessosApagados).toBeGreaterThanOrEqual(1);
    expect(r.solicitacoesRedigidas).toBe(1);
    expect(await textoDe('SELECT placa FROM sessoes_estacionamento')).not.toContain('VEL1A11');
    expect(
      await textoDe('SELECT titular_nome, titular_contato, identificador FROM lgpd_solicitacoes'),
    ).not.toMatch(/Maria|maria@|ABC1D23/);
    // Política editável e registrada
    await admin
      .put('/api/v1/privacidade/retencao')
      .send({ placasMeses: 36, acessosPainelDias: 90, historicoMeses: 60, solicitacoesMeses: 6 })
      .expect(200);
    expect((await admin.get('/api/v1/privacidade/retencao').expect(200)).body.politica.placasMeses).toBe(36);
    await admin.put('/api/v1/privacidade/retencao').send({ placasMeses: 0 }).expect(400);
  });

  it('encarregado: salvo e enviado ao app do cliente', async () => {
    await admin
      .put('/api/v1/privacidade/encarregado')
      .send({ nome: 'Encarregado Teste', contato: 'privacidade@exemplo.com' })
      .expect(200);
    expect((await projecaoSite(pool, siteId)).contatoPrivacidade).toBe(
      'Encarregado Teste — privacidade@exemplo.com',
    );
  });
});

describe('dados pessoais fora dos logs e das mensagens', () => {
  it('log: placas, CPF e e-mail mascarados; campos sensíveis ocultos; SQL removido', () => {
    const linhas: string[] = [];
    const log = pino(
      { ...opcoesLogger, level: 'info' },
      new Writable({
        write(c, _e, cb) {
          linhas.push(String(c));
          cb();
        },
      }),
    );
    log.warn(
      { placa: 'ABC1D23', termo: 'ABC1D23', cpf: '12345678901' },
      'Ticket nº 41 (ABC-1D23) de joao@exemplo.com',
    );
    log.error(
      { err: Object.assign(new Error("Duplicate entry 'ABC1D23'"), { sql: "INSERT ... 'ABC1D23'" }) },
      'falhou',
    );
    const tudo = linhas.join('\n');
    expect(tudo).not.toMatch(/ABC1D23|ABC-1D23|12345678901|joao@exemplo\.com/);
    expect(tudo).toContain('[oculto]');
    expect(tudo).toContain('[placa]');
  });

  it('rota inexistente não devolve a query string (que pode ter dados pessoais)', async () => {
    const r = await admin.get('/api/v1/nao-existe?termo=ABC1D23').expect(404);
    expect(JSON.stringify(r.body)).not.toContain('ABC1D23');
  });

  it('erro interno não expõe detalhes do banco na resposta', async () => {
    const r = await admin.get('/api/v1/privacidade/titular?placa=ABC%27%3B--').expect(400);
    expect(JSON.stringify(r.body)).not.toMatch(/SQL|syntax|mysql/i);
  });
});
