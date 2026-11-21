import { createHash, randomBytes } from 'node:crypto';
import express from 'express';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TicketPublico } from '@estacionamento/shared';
import { criarApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { fecharPool, pool } from '../src/db/pool.js';
import { migrarBancoNuvem } from '../src/db/migrar.js';
import { exigirHttps } from '../src/http/middlewares/https.js';
import { publicoRepository } from '../src/modules/publico/publico.repository.js';
import { limitadorTicket } from '../src/modules/publico/publico.routes.js';

const app = criarApp();
const SITE = '01JSITEPUBLICO000000000000';
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
const novoToken = () => randomBytes(32).toString('base64url');
const hash = (t: string) => createHash('sha256').update(t).digest();
const ticket = (token: string) => request(app).get('/v1/ticket').set('Authorization', `Ticket ${token}`);
const tokens: Record<string, string> = {};

async function criarTicket(id: string, o: Record<string, unknown>) {
  await pool.query(
    `INSERT INTO tickets_publicos (id, site_id, numero, placa, categoria, vaga, modalidade, situacao, entrada_em, saida_em, regra,
       tarifa_descricao, valor_final_centavos, itens_final, pago_centavos, acesso_expira_em, sincronizado_em)
     VALUES (?, ?, ?, ?, 'Carro', 'A-01', 'AVULSO', ?, NOW(3) - INTERVAL ? SECOND, ?, ?, 'Padrão', ?, ?, ?, ?, NOW(3))`,
    [
      id,
      SITE,
      o.numero,
      o.placa,
      o.situacao,
      Number(o.minutos) * 60 - 20,
      o.saida ?? null,
      JSON.stringify(REGRA),
      o.final ?? null,
      o.itens ?? null,
      o.pago ?? 0,
      o.expira ?? null,
    ],
  );
  tokens[id] = novoToken();
  await pool.query('INSERT INTO tickets_tokens (token_hash, ticket_id, revogado_em) VALUES (?, ?, ?)', [
    hash(tokens[id]!),
    id,
    o.revogado ?? null,
  ]);
}

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
    "INSERT INTO sites_publicos (id, slug, nome, endereco, sincronizado_em) VALUES (?, 'centro', 'Estacionamento Centro', 'Rua A, 100', NOW(3))",
    [SITE],
  );
  await pool.query(
    `INSERT INTO disponibilidade_publica (site_id, categoria_id, categoria, ordem, total, livres, atualizado_em)
     VALUES (?, '01JCATCARRO000000000000000', 'Carro', 1, 30, 12, NOW(3)), (?, '01JCATMOTO0000000000000000', 'Moto', 2, 10, 4, NOW(3))`,
    [SITE, SITE],
  );
  await pool.query(
    `INSERT INTO tarifas_publicas (id, site_id, categoria, ordem, nome, especial, condicao, linhas, vigente_desde)
     VALUES ('01JREGRA000000000000000001', ?, 'Carro', 100, 'Padrão', FALSE, NULL, ?, NOW(3) - INTERVAL 1 DAY)`,
    [SITE, JSON.stringify(['1ª hora: R$ 10,00'])],
  );
  await criarTicket('01JTICKETABERTO00000000000', {
    numero: 41,
    placa: 'ABC1D23',
    situacao: 'ESTACIONADO',
    minutos: 80,
    pago: 500,
  });
  await criarTicket('01JTICKETFECHADO0000000000', {
    numero: 42,
    placa: 'XYZ9A87',
    situacao: 'ENCERRADO',
    minutos: 200,
    final: 2000,
    pago: 2000,
    itens: JSON.stringify([
      { descricao: '1ª hora', quantidade: 1, unitarioCentavos: 1000, totalCentavos: 1000 },
    ]),
    expira: new Date(Date.now() + 20 * 3600_000),
  });
  await criarTicket('01JTICKETEXPIRADO000000000', {
    numero: 43,
    placa: 'OLD1A11',
    situacao: 'ENCERRADO',
    minutos: 2000,
    final: 4000,
    pago: 4000,
    expira: new Date(Date.now() - 60_000),
  });
  await criarTicket('01JTICKETREVOGADO000000000', {
    numero: 44,
    placa: 'REV1A11',
    situacao: 'ESTACIONADO',
    minutos: 30,
    revogado: new Date(),
  });
});
beforeEach(() => limitadorTicket.limpar());
afterAll(() => fecharPool());

describe('ticket do cliente (pelo token do link)', () => {
  it('estacionado: valor acumulado agora, pela tarifa gravada no ticket, e o que falta pagar', async () => {
    const r = await ticket(tokens['01JTICKETABERTO00000000000']!).expect(200);
    const t = r.body as TicketPublico;
    expect(t).toMatchObject({
      numero: '41',
      placa: 'ABC1D23',
      situacao: 'ESTACIONADO',
      permanenciaMin: 80,
      valorCentavos: 1400, // 1ª hora + 20 min = 2 frações
      pagoCentavos: 500,
      aPagarCentavos: 900,
      estacionamento: { slug: 'centro', nome: 'Estacionamento Centro' },
      proximaCobranca: { valorCentavos: 1600 },
    });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('encerrado: valor final e itens gravados; o link expira 24h após a saída', async () => {
    const t = (await ticket(tokens['01JTICKETFECHADO0000000000']!).expect(200)).body as TicketPublico;
    expect(t).toMatchObject({
      situacao: 'ENCERRADO',
      valorCentavos: 2000,
      aPagarCentavos: 0,
      proximaCobranca: null,
    });
    expect(t.itens).toHaveLength(1);
    expect(t.acessoExpiraEm).not.toBeNull();
  });

  it('só o ticket do token: a resposta não traz identificadores internos nem dados de outros tickets', async () => {
    const t = (await ticket(tokens['01JTICKETABERTO00000000000']!).expect(200)).body;
    const texto = JSON.stringify(t);
    expect(texto).not.toMatch(/01JTICKET|01JSITE|token|hash|XYZ9A87/i);
  });

  it('token errado, revogado, expirado ou malformado: mesma resposta 404', async () => {
    const respostas = await Promise.all([
      ticket(novoToken()),
      ticket(tokens['01JTICKETREVOGADO000000000']!),
      ticket(tokens['01JTICKETEXPIRADO000000000']!),
      ticket('curto'),
      request(app).get('/v1/ticket'),
      request(app).get('/v1/ticket').set('Authorization', `Bearer ${tokens['01JTICKETABERTO00000000000']}`),
    ]);
    expect(respostas.map((x) => x.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect(new Set(respostas.map((x) => JSON.stringify(x.body))).size).toBe(1);
  });

  it('muitos clientes no mesmo IP (NAT da operadora) acompanham seus tickets sem bloqueio', async () => {
    const valido = tokens['01JTICKETABERTO00000000000']!;
    const outro = tokens['01JTICKETFECHADO0000000000']!;
    // 2 tickets × 10 consultas pelo mesmo IP: passa do antigo limite de 8/IP, mas é uso normal
    const r = [];
    for (let i = 0; i < 10; i++) r.push((await ticket(valido)).status, (await ticket(outro)).status);
    expect(r.every((s) => s === 200)).toBe(true);
  });

  it('limita as consultas de um mesmo ticket', async () => {
    const valido = tokens['01JTICKETABERTO00000000000']!;
    const r = [];
    for (let i = 0; i < 14; i++) r.push((await ticket(valido)).status);
    expect(r.slice(0, 12).every((s) => s === 200)).toBe(true);
    expect(r.slice(12)).toEqual([429, 429]);
  });

  it('limita as tentativas por IP (quem tenta adivinhar links)', async () => {
    const r = [];
    for (let i = 0; i < 10; i++) r.push((await ticket(novoToken())).status);
    expect(r.slice(0, 8).every((s) => s === 404)).toBe(true);
    expect(r.slice(8)).toEqual([429, 429]);
  });

  it('tabela de tarifas do próprio ticket (regra gravada na entrada) e política de encerramento', async () => {
    const t = (await ticket(tokens['01JTICKETABERTO00000000000']!).expect(200)).body as TicketPublico;
    // A tabela em vigor hoje só tem "1ª hora: R$ 10,00"; o ticket mostra a regra gravada nele
    const espacos = (l: string[]) => l.map((x) => x.replace(/\s/g, ' '));
    expect({ ...t.tabelaTarifa, linhas: espacos(t.tabelaTarifa.linhas) }).toEqual({
      nome: 'Padrão',
      categoria: 'Carro',
      linhas: [
        '1ª hora: R$ 10,00',
        'Hora adicional: R$ 6,00',
        'Depois da 1ª hora, fração de 15 min: R$ 2,00',
        'Máximo de R$ 40,00 a cada 24h',
        'Diária: R$ 35,00',
        'Tolerância: até 10 min sem cobrança',
      ],
    });
    expect(t.politicaAcesso).toEqual({ horasAposSaida: 24 });
    expect(Date.parse(t.calculadoEm)).toBeGreaterThan(Date.now() - 60_000);
    await pool.query('UPDATE sites_publicos SET horas_acesso_apos_saida = 2 WHERE id = ?', [SITE]);
    const t2 = (await ticket(tokens['01JTICKETABERTO00000000000']!).expect(200)).body as TicketPublico;
    expect(t2.politicaAcesso).toEqual({ horasAposSaida: 2 });
    await pool.query('UPDATE sites_publicos SET horas_acesso_apos_saida = 24 WHERE id = ?', [SITE]);
  });

  it('alterar o código manualmente não dá acesso a outro ticket', async () => {
    const valido = tokens['01JTICKETABERTO00000000000']!;
    // Troca de um caractere em cada posição: nunca abre outro ticket
    const alterados = [0, 10, 21, 42].map((i) => {
      const c = valido[i] === 'A' ? 'B' : 'A';
      return valido.slice(0, i) + c + valido.slice(i + 1);
    });
    // (o limite por IP é zerado a cada tentativa: aqui testamos o token, não o limitador)
    const tentar = (tk: string) => (limitadorTicket.limpar(), ticket(tk).expect(404));
    for (const a of alterados) await tentar(a);
    // Número do ticket, placa ou identificador no lugar do token / na URL
    for (const tentativa of [
      '41',
      'ABC1D23',
      '01JTICKETABERTO00000000000',
      `${valido}x`,
      valido.slice(0, 42),
    ]) {
      await tentar(tentativa);
    }
    for (const rota of [
      '/v1/ticket/41',
      '/v1/ticket/01JTICKETABERTO00000000000',
      '/v1/tickets?placa=ABC1D23',
      '/v1/sites/centro/tickets',
    ]) {
      limitadorTicket.limpar();
      await request(app).get(rota).set('Authorization', `Ticket ${valido}`).expect(404);
    }
    // Cada token devolve só o seu ticket
    limitadorTicket.limpar();
    const outro = (await ticket(tokens['01JTICKETFECHADO0000000000']!).expect(200)).body as TicketPublico;
    expect(outro.placa).toBe('XYZ9A87');
  });

  it('retenção: acesso encerrado responde 404; o registro é apagado 30 dias após a saída', async () => {
    await criarTicket('01JTICKETANTIGO00000000000', {
      numero: 45,
      placa: 'ANT1G00',
      situacao: 'ENCERRADO',
      minutos: 60 * 24 * 32,
      saida: new Date(Date.now() - 31 * 24 * 3600_000),
      final: 1000,
      pago: 1000,
      expira: new Date(Date.now() - 30 * 24 * 3600_000),
    });
    expect(await publicoRepository.apagarRegistrosVencidos()).toBe(1);
    const [restantes] = await pool.query<mysql.RowDataPacket[]>('SELECT placa FROM tickets_publicos');
    const placas = restantes.map((x) => x.placa);
    expect(placas).not.toContain('ANT1G00');
    expect(placas).toContain('OLD1A11'); // acesso já encerrado, registro ainda dentro dos 30 dias
    await ticket(tokens['01JTICKETEXPIRADO000000000']!).expect(404);
    const [[k]] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM tickets_tokens WHERE ticket_id = '01JTICKETANTIGO00000000000'",
    );
    expect(Number(k?.n)).toBe(0);
  });

  it('o token não aparece na URL: na query string ele é ignorado', async () => {
    await request(app).get(`/v1/ticket?token=${tokens['01JTICKETABERTO00000000000']}`).expect(404);
  });
});

describe('disponibilidade e tarifas (públicas)', () => {
  it('vagas livres por categoria e tabela de preços', async () => {
    const d = (await request(app).get('/v1/sites/centro/disponibilidade').expect(200)).body;
    expect(d).toMatchObject({
      totalVagas: 40,
      vagasLivres: 16,
      categorias: [
        { categoria: 'Carro', livres: 12 },
        { categoria: 'Moto', livres: 4 },
      ],
    });
    const t = (await request(app).get('/v1/sites/centro/tarifas').expect(200)).body;
    expect(t.tarifas).toEqual([
      { categoria: 'Carro', nome: 'Padrão', especial: false, condicao: null, linhas: ['1ª hora: R$ 10,00'] },
    ]);
    await request(app).get('/v1/sites/nao-existe/disponibilidade').expect(404);
    await request(app).get('/v1/sites/..%2F..%2Fetc/tarifas').expect(404);
  });
});

describe('segurança da API pública', () => {
  it('não existe nenhuma rota administrativa e nada além de leitura', async () => {
    for (const rota of [
      '/api/v1/auth/login',
      '/api/v1/usuarios',
      '/api/v1/financeiro/resumo',
      '/v1/sessoes',
      '/v1/admin',
    ]) {
      await request(app).get(rota).expect(404);
    }
    await request(app).post('/v1/ticket').send({}).expect(405);
    await request(app).delete('/v1/sites/centro/tarifas').expect(405);
  });

  it('CORS só para o endereço do PWA', async () => {
    const ok = await request(app)
      .options('/v1/ticket')
      .set('Origin', 'https://app.exemplo.com.br')
      .expect(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.exemplo.com.br');
    expect(ok.headers['access-control-allow-headers']).toBe('Authorization');
    await request(app).options('/v1/ticket').set('Origin', 'https://site-malicioso.com').expect(403);
    const outro = await request(app)
      .get('/v1/sites/centro/tarifas')
      .set('Origin', 'https://site-malicioso.com');
    expect(outro.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('cabeçalhos de segurança', async () => {
    const r = await request(app).get('/v1/sites/centro/tarifas');
    expect(r.headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('HTTPS obrigatório em produção (atrás do proxy do provedor)', async () => {
    const a = express();
    a.set('trust proxy', 1);
    a.use(exigirHttps(true));
    a.get('/v1/x', (_req, res) => res.json({ ok: true }));
    a.post('/v1/x', (_req, res) => res.json({ ok: true }));
    const r = await request(a)
      .get('/v1/x')
      .set('Host', 'api.exemplo.com.br')
      .set('X-Forwarded-Proto', 'http')
      .expect(301);
    expect(r.headers.location).toBe('https://api.exemplo.com.br/v1/x');
    await request(a).post('/v1/x').set('X-Forwarded-Proto', 'http').expect(403);
    await request(a).get('/v1/x').set('X-Forwarded-Proto', 'https').expect(200);
  });
});
