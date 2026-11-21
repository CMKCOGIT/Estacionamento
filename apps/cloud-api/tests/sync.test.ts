import { createHash, createHmac, randomBytes } from 'node:crypto';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  textoParaAssinar,
  type EventoSync,
  type ParteSnapshotSync,
  type ProjecaoTicket,
  type TicketPublico,
} from '@estacionamento/shared';
import { criarApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { migrarBancoNuvem } from '../src/db/migrar.js';
import { fecharPool, pool } from '../src/db/pool.js';
import { derivarSegredo } from '../src/integracoes/credenciais.js';
import { ulid } from '../src/integracoes/ulid.js';
import { limitadorTicket } from '../src/modules/publico/publico.routes.js';
import { limitadorSync } from '../src/modules/sync/sync.routes.js';

const app = criarApp();
const SITE = ulid();
const OUTRO_SITE = ulid();
const LOCAL = ulid(); // credencial do servidor local (vincula no primeiro envio)
const OUTRA = ulid(); // credencial de outro estacionamento
const REVOGADA = ulid();
const SO_LEITURA = ulid();
const TABELA = ulid();
const TICKET_A = ulid();
const TICKET_B = ulid();
const tokenA = randomBytes(32).toString('base64url');
const tokenB = randomBytes(32).toString('base64url');
const hashHex = (t: string) => createHash('sha256').update(t).digest('hex');
const REGRA = {
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
let seq = 100;

function enviar(
  metodo: 'POST' | 'GET',
  rota: string,
  corpo: unknown,
  o: { id?: string; versao?: number; ts?: number; nonce?: string; alterarCorpo?: boolean } = {},
) {
  const id = o.id ?? LOCAL;
  const bruto = corpo === undefined ? '' : JSON.stringify(corpo);
  const timestamp = String(o.ts ?? Math.floor(Date.now() / 1000));
  const nonce = o.nonce ?? randomBytes(16).toString('hex');
  const assinatura = createHmac('sha256', derivarSegredo(id, o.versao ?? 1))
    .update(
      textoParaAssinar({
        timestamp,
        nonce,
        metodo,
        rota,
        sha256Corpo: createHash('sha256').update(bruto).digest('hex'),
      }),
    )
    .digest('hex');
  const r = (metodo === 'POST' ? request(app).post(rota) : request(app).get(rota))
    .set('Content-Type', 'application/json')
    .set('X-Integracao-Id', id)
    .set('X-Timestamp', timestamp)
    .set('X-Nonce', nonce)
    .set('X-Assinatura', `v1=${assinatura}`);
  return metodo === 'POST' ? r.send(o.alterarCorpo ? bruto.replace('Centro', 'Outro') : bruto) : r;
}

const ticket = (id: string, extra: Partial<ProjecaoTicket> = {}): ProjecaoTicket => ({
  id,
  numero: 7,
  placa: 'ABC1D23',
  categoria: 'Carro',
  vaga: 'A-01',
  modalidade: 'AVULSO',
  situacao: 'ESTACIONADO',
  entradaEm: new Date(Date.now() - 80 * 60_000 + 20_000).toISOString(),
  saidaEm: null,
  regra: REGRA,
  tarifaNome: 'Padrão',
  tarifaDescricao: '1ª hora R$ 10,00',
  valorFinalCentavos: null,
  itensFinal: null,
  pagoCentavos: 0,
  acessoExpiraEm: null,
  tokens: [{ hash: hashHex(tokenA), revogadoEm: null }],
  ...extra,
});
const evento = (dados: EventoSync['dados'], tipo = 'ticket.atualizado', s = ++seq): EventoSync => ({
  eventId: ulid(),
  seq: s,
  tipo,
  versao: 2,
  ocorridoEm: new Date().toISOString(),
  agregado: { tipo: 'ticket', id: 'id' in dados ? String(dados.id) : 'x' },
  dados,
});
const push = (eventos: EventoSync[], o = {}) => enviar('POST', '/sync/v1/push', { siteId: SITE, eventos }, o);
const consultar = (token: string) => request(app).get('/v1/ticket').set('Authorization', `Ticket ${token}`);
const snapshot = (p: Partial<ParteSnapshotSync> = {}): ParteSnapshotSync => ({
  siteId: SITE,
  snapshotId: ulid(),
  parte: 1,
  totalPartes: 1,
  seq: 100,
  site: {
    slug: 'centro',
    nome: 'Estacionamento Centro',
    endereco: 'Rua A, 100',
    telefone: null,
    horasAcessoAposSaida: 24,
  },
  disponibilidade: { categorias: [{ id: ulid(), nome: 'Carro', ordem: 1, total: 30, livres: 12 }] },
  tabelas: [
    {
      tabelaId: TABELA,
      versao: 1,
      vigenteDesde: new Date(Date.now() - 86_400_000).toISOString(),
      tarifas: [
        {
          id: ulid(),
          categoria: 'Carro',
          ordem: 100,
          nome: 'Padrão',
          especial: false,
          condicao: null,
          linhas: ['1ª hora: R$ 10,00'],
        },
      ],
    },
  ],
  tickets: [
    ticket(TICKET_A),
    ticket(TICKET_B, { numero: 8, placa: 'XYZ9A87', tokens: [{ hash: hashHex(tokenB), revogadoEm: null }] }),
  ],
  ...p,
});

beforeAll(async () => {
  const c = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  });
  await c.query(`DROP DATABASE IF EXISTS \`${env.DB_NAME}\``);
  await c.end();
  await migrarBancoNuvem({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    banco: env.DB_NAME,
  });
  await pool.query(
    `INSERT INTO integracoes (id, site_id, tipo, nome, escopos, ativo) VALUES
       (?, NULL, 'SERVIDOR_LOCAL', 'Centro', '["sync:escrever","sync:ler"]', TRUE),
       (?, ?, 'SERVIDOR_LOCAL', 'Outro', '["sync:escrever","sync:ler"]', TRUE),
       (?, NULL, 'SERVIDOR_LOCAL', 'Revogada', '["sync:escrever"]', FALSE),
       (?, NULL, 'PARCEIRO', 'Só leitura', '["sync:ler"]', TRUE)`,
    [LOCAL, OUTRA, OUTRO_SITE, REVOGADA, SO_LEITURA],
  );
});
beforeEach(() => {
  limitadorSync.limpar();
  limitadorTicket.limpar();
});
afterAll(() => fecharPool());

describe('recebimento dos dados do servidor local', () => {
  it('antes da carga completa, eventos são recusados (409: envie o snapshot)', async () => {
    const r = await push([evento({ tipo: 'ticket', ticket: ticket(TICKET_A) })]).expect(409);
    expect(r.body.erro.codigo).toBe('CONFLITO');
  });

  it('carga completa: estacionamento, vagas, tarifas e tickets; a credencial fica presa ao estacionamento', async () => {
    const r = await enviar('POST', '/sync/v1/snapshot', snapshot()).expect(200);
    expect(r.body).toMatchObject({ parte: 1, concluido: true, removidos: 0 });
    const [[i]] = await pool.query<RowDataPacket[]>('SELECT site_id FROM integracoes WHERE id = ?', [LOCAL]);
    expect(i?.site_id).toBe(SITE);

    expect((await request(app).get('/v1/sites/centro/disponibilidade').expect(200)).body).toMatchObject({
      vagasLivres: 12,
    });
    const t = (await consultar(tokenA).expect(200)).body as TicketPublico;
    expect(t).toMatchObject({ placa: 'ABC1D23', situacao: 'ESTACIONADO', valorCentavos: 1400 });
  });

  it('evento aplica o estado novo; repetido é confirmado sem aplicar; atrasado não desfaz o novo', async () => {
    const fechado = evento(
      {
        tipo: 'ticket',
        ticket: ticket(TICKET_A, {
          situacao: 'ENCERRADO',
          saidaEm: new Date().toISOString(),
          valorFinalCentavos: 1400,
          pagoCentavos: 1400,
          itensFinal: [{ descricao: '1ª hora', quantidade: 1, unitarioCentavos: 1000, totalCentavos: 1000 }],
          acessoExpiraEm: new Date(Date.now() + 24 * 3600_000).toISOString(),
        }),
      },
      'ticket.fechado',
      200,
    );
    expect((await push([fechado]).expect(200)).body).toMatchObject({ aplicados: 1, ultimoSeq: 200 });
    expect((await consultar(tokenA).expect(200)).body).toMatchObject({
      situacao: 'ENCERRADO',
      valorCentavos: 1400,
    });

    expect((await push([fechado]).expect(200)).body).toMatchObject({ aplicados: 0, repetidos: 1 });
    const atrasado = evento({ tipo: 'ticket', ticket: ticket(TICKET_A) }, 'ticket.pagamento', 150);
    expect((await push([atrasado]).expect(200)).body).toMatchObject({ superados: 1 });
    expect((await consultar(tokenA).expect(200)).body.situacao).toBe('ENCERRADO');
  });

  it('evento inválido é rejeitado sozinho (com o motivo); os outros do lote são aplicados', async () => {
    const invalido = evento({ tipo: 'ticket', ticket: ticket(TICKET_B, { placa: 'abc' }) });
    const valido = evento({
      tipo: 'ticket',
      ticket: ticket(TICKET_B, { vaga: 'B-02', tokens: [{ hash: hashHex(tokenB), revogadoEm: null }] }),
    });
    const r = (await push([invalido, valido]).expect(200)).body;
    expect(r.aplicados).toBe(1);
    expect(r.rejeitados).toEqual([{ eventId: invalido.eventId, motivo: expect.stringMatching(/placa/) }]);
    expect((await consultar(tokenB).expect(200)).body.vaga).toBe('B-02');
  });

  it('só a projeção pública é guardada: campos a mais (pagamentos, operador) são descartados', async () => {
    const comExtras = evento({
      tipo: 'ticket',
      ticket: {
        ...ticket(TICKET_B, { tokens: [{ hash: hashHex(tokenB), revogadoEm: null }] }),
        operador: 'Ana',
        pagamentos: [{ forma: 'PIX' }],
      } as ProjecaoTicket,
    });
    await push([comExtras]).expect(200);
    const [[l]] = await pool.query<RowDataPacket[]>('SELECT * FROM tickets_publicos WHERE id = ?', [
      TICKET_B,
    ]);
    expect(JSON.stringify(l)).not.toMatch(/Ana|PIX/);
  });

  it('token revogado no local deixa de funcionar na nuvem (novo link)', async () => {
    const novo = randomBytes(32).toString('base64url');
    await push([
      evento(
        { tipo: 'ticket', ticket: ticket(TICKET_B, { tokens: [{ hash: hashHex(novo), revogadoEm: null }] }) },
        'ticket.token_revogado',
      ),
    ]).expect(200);
    await consultar(tokenB).expect(404);
    await consultar(novo).expect(200);
  });

  it('tabela publicada para o futuro só vale na data', async () => {
    const futura = ulid();
    await push([
      evento(
        {
          tipo: 'tabela_tarifa',
          tabela: {
            tabelaId: futura,
            versao: 2,
            vigenteDesde: new Date(Date.now() + 86_400_000).toISOString(),
            tarifas: [
              {
                id: ulid(),
                categoria: 'Carro',
                ordem: 100,
                nome: 'Padrão',
                especial: false,
                condicao: null,
                linhas: ['1ª hora: R$ 99,00'],
              },
            ],
          },
        },
        'tarifa.publicada',
      ),
    ]).expect(200);
    const t = (await request(app).get('/v1/sites/centro/tarifas').expect(200)).body;
    expect(t.tarifas[0].linhas).toEqual(['1ª hora: R$ 10,00']);
  });

  it('lote vazio é sinal de vida; status mostra o último seq e o contato', async () => {
    await pool.query('UPDATE sites_publicos SET sincronizado_em = NOW(3) - INTERVAL 1 HOUR');
    await push([]).expect(200);
    const [[s]] = await pool.query<RowDataPacket[]>(
      'SELECT TIMESTAMPDIFF(SECOND, sincronizado_em, NOW(3)) AS idade FROM sites_publicos WHERE id = ?',
      [SITE],
    );
    expect(Number(s?.idade)).toBeLessThan(5);
    const st = (await enviar('GET', '/sync/v1/status', undefined).expect(200)).body;
    expect(st).toMatchObject({ siteId: SITE, ultimoSeq: expect.any(Number) });
    expect(st.ultimoSeq).toBeGreaterThanOrEqual(200);
  });

  it('nova carga completa remove da nuvem o que não existe mais no local', async () => {
    const r = await enviar(
      'POST',
      '/sync/v1/snapshot',
      snapshot({ seq: 1000, tickets: [ticket(TICKET_A)] }),
    ).expect(200);
    expect(r.body.removidos).toBe(1);
    const [[n]] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM tickets_publicos WHERE id = ?',
      [TICKET_B],
    );
    expect(Number(n?.n)).toBe(0);
  });
});

describe('autenticação das integrações', () => {
  const lote = { siteId: SITE, eventos: [] };

  it('recusa sem credencial, assinatura errada, corpo alterado, horário velho, replay e credencial revogada', async () => {
    await request(app).post('/sync/v1/push').send(lote).expect(401);
    await request(app).post('/sync/v1/push').set('Authorization', `Ticket ${tokenA}`).send(lote).expect(401);
    await enviar('POST', '/sync/v1/push', lote, { versao: 9 }).expect(401); // segredo errado
    await enviar('POST', '/sync/v1/snapshot', snapshot(), { alterarCorpo: true }).expect(401);
    await enviar('POST', '/sync/v1/push', lote, { ts: Math.floor(Date.now() / 1000) - 600 }).expect(401);
    const nonce = randomBytes(16).toString('hex');
    await enviar('POST', '/sync/v1/push', lote, { nonce }).expect(200);
    await enviar('POST', '/sync/v1/push', lote, { nonce }).expect(401); // a mesma requisição de novo
    await enviar('POST', '/sync/v1/push', lote, { id: REVOGADA }).expect(401);
    const respostas = await Promise.all([
      request(app).post('/sync/v1/push').send(lote),
      enviar('POST', '/sync/v1/push', lote, { versao: 9 }),
    ]);
    expect(new Set(respostas.map((x) => JSON.stringify(x.body))).size).toBe(1); // resposta idêntica
  });

  it('um estacionamento não escreve nos dados de outro; escopo é exigido', async () => {
    await enviar('POST', '/sync/v1/push', lote, { id: OUTRA }).expect(403);
    await enviar('POST', '/sync/v1/push', { siteId: OUTRO_SITE, eventos: [] }, { id: LOCAL }).expect(403);
    await enviar('POST', '/sync/v1/push', lote, { id: SO_LEITURA }).expect(403);
  });

  it('troca de segredo: o anterior vale durante a transição', async () => {
    await pool.query(
      'UPDATE integracoes SET versao_chave = 2, anterior_valida_ate = NOW(3) + INTERVAL 1 HOUR WHERE id = ?',
      [LOCAL],
    );
    await enviar('POST', '/sync/v1/push', lote, { versao: 2 }).expect(200);
    await enviar('POST', '/sync/v1/push', lote, { versao: 1 }).expect(200);
    await pool.query('UPDATE integracoes SET anterior_valida_ate = NOW(3) - INTERVAL 1 SECOND WHERE id = ?', [
      LOCAL,
    ]);
    await enviar('POST', '/sync/v1/push', lote, { versao: 1 }).expect(401);
    await pool.query('UPDATE integracoes SET versao_chave = 1, anterior_valida_ate = NULL WHERE id = ?', [
      LOCAL,
    ]);
  });

  it('JSON inválido ou fora do formato: 400 com os detalhes', async () => {
    const r = await enviar('POST', '/sync/v1/push', { siteId: SITE, eventos: [{ seq: 'x' }] }).expect(400);
    expect(r.body.erro.codigo).toBe('REQUISICAO_INVALIDA');
  });
});

describe('clientes não alteram dados e o registro guarda o que importa', () => {
  it('rotas de escrita só para integrações; /v1 é só leitura; sem CORS de escrita', async () => {
    await request(app).post('/v1/ticket').set('Authorization', `Ticket ${tokenA}`).expect(405);
    await request(app).put('/v1/sites/centro/tarifas').expect(405);
    await request(app).delete('/sync/v1/push').expect(405);
    const pre = await request(app)
      .options('/sync/v1/push')
      .set('Origin', 'https://app.exemplo.com.br')
      .set('Access-Control-Request-Method', 'POST');
    expect(pre.headers['access-control-allow-methods'] ?? '').not.toMatch(/POST/);
  });

  it('registro: lotes, vínculo, recusas e limite; nunca tokens, segredos ou IP em claro', async () => {
    const [l] = await pool.query<RowDataPacket[]>(
      'SELECT tipo, ip_hash, detalhes, requisicao_id FROM registro_api',
    );
    const tipos = new Set(l.map((x) => x.tipo));
    for (const t of [
      'sync.lote',
      'sync.snapshot',
      'sync.vinculado',
      'sync.rejeitado',
      'auth.recusada',
      'requisicao.invalida',
    ])
      expect(tipos).toContain(t);
    const tudo = JSON.stringify(l);
    expect(tudo).not.toContain(tokenA);
    expect(tudo).not.toContain(derivarSegredo(LOCAL, 1));
    expect(tudo).not.toMatch(/127\.0\.0\.1|::1|::ffff/);
    expect(l.every((x) => x.requisicao_id)).toBe(true);
  });

  it('toda resposta tem X-Request-Id', async () => {
    const r = await request(app).get('/saude');
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('documentação das rotas', () => {
  it('toda rota da API está em openapi.yaml', async () => {
    const { readFile } = await import('node:fs/promises');
    const { modulos } = await import('../src/modules/index.js');
    const yaml = await readFile(new URL('../openapi.yaml', import.meta.url), 'utf8');
    const documentadas = new Set([...yaml.matchAll(/^ {2}(\/[^:\s]+):$/gm)].map((m) => m[1]));
    const rotas = modulos.flatMap((m) =>
      (m.router.stack as { route?: { path: string } }[])
        .filter((l) => l.route)
        .map((l) => `${m.caminho}${l.route!.path}`.replace(/:(\w+)/g, '{$1}')),
    );
    expect(rotas.length).toBeGreaterThanOrEqual(6);
    for (const r of [...rotas, '/saude']) expect(documentadas, r).toContain(r);
  });
});
