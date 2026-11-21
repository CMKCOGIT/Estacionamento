import { createHash, createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CABECALHOS_INTEGRACAO as H,
  textoParaAssinar,
  type LoteSync,
  type ParteSnapshotSync,
  type ResultadoEntrada,
} from '@estacionamento/shared';
import { criarApp } from '../../src/app.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import { criarCadastrosBase, type CadastrosBase } from '../../src/modules/demonstracao/cenario.js';
import { TrabalhadorSync } from '../../src/sync/worker.js';
import { ADMIN, entrar, garantirAdmin } from './ajuda.js';

/**
 * Worker de sincronização contra uma "nuvem" de mentira, que confere a
 * assinatura de cada requisição e responde o que o teste mandar.
 */
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const INTEGRACAO = '01JINTEGRACAO0000000000000';
interface Chamada {
  rota: string;
  corpo: unknown;
  assinaturaOk: boolean;
}
const chamadas: Chamada[] = [];
let responder: (rota: string, corpo: unknown) => { status: number; corpo: unknown } = () => ({
  status: 503,
  corpo: {},
});
let nuvem: Server;
let trabalhador: TrabalhadorSync;
const app = criarApp();
let admin: Awaited<ReturnType<typeof entrar>>;
let siteId: string;
let base: CadastrosBase;

const respostaPush = (lote: LoteSync, rejeitar: string[] = []) => ({
  aplicados: lote.eventos.length - rejeitar.length,
  repetidos: 0,
  superados: 0,
  rejeitados: rejeitar.map((eventId) => ({ eventId, motivo: 'placa inválida' })),
  ultimoSeq: lote.eventos.at(-1)?.seq ?? 0,
  recebidoEm: new Date().toISOString(),
});
const nuvemNormal = (rota: string, corpo: unknown) =>
  rota.endsWith('/snapshot')
    ? {
        status: 200,
        corpo: {
          snapshotId: (corpo as ParteSnapshotSync).snapshotId,
          parte: 1,
          concluido: true,
          removidos: 0,
        },
      }
    : { status: 200, corpo: respostaPush(corpo as LoteSync) };
const estado = async () =>
  (await pool.query<RowDataPacket[]>('SELECT * FROM sync_estado WHERE site_id = ?', [siteId]))[0][0]!;
const contar = async (status: string) =>
  Number(
    (
      await pool.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM sync_outbox WHERE status = ? AND versao >= 2',
        [status],
      )
    )[0][0]?.n,
  );
/** Espera o "assentamento" de 1 s dos eventos novos e roda um ciclo. */
async function ciclo() {
  await new Promise((r) => setTimeout(r, 1100));
  (trabalhador as unknown as { esperarAte: number }).esperarAte = 0;
  return trabalhador.ciclo();
}
const entrada = async (placa: string) =>
  (
    await admin
      .post('/api/v1/sessoes/entrada')
      .send({ placa, categoriaId: base.categorias.carro })
      .expect(201)
  ).body as ResultadoEntrada;

beforeAll(async () => {
  nuvem = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on('data', (p: Buffer) => partes.push(p));
    req.on('end', () => {
      const bruto = Buffer.concat(partes);
      const texto = textoParaAssinar({
        timestamp: String(req.headers[H.timestamp]),
        nonce: String(req.headers[H.nonce]),
        metodo: req.method!,
        rota: req.url!,
        sha256Corpo: createHash('sha256').update(bruto).digest('hex'),
      });
      const esperada = `v1=${createHmac('sha256', SEGREDO).update(texto).digest('hex')}`;
      const corpo = bruto.length ? JSON.parse(bruto.toString()) : null;
      chamadas.push({
        rota: req.url!,
        corpo,
        assinaturaOk: req.headers[H.assinatura] === esperada && req.headers[H.id] === INTEGRACAO,
      });
      const r = responder(req.url!, corpo);
      res.writeHead(r.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(r.corpo));
    });
  });
  await new Promise<void>((r) => nuvem.listen(0, '127.0.0.1', r));
  const porta = (nuvem.address() as AddressInfo).port;
  trabalhador = new TrabalhadorSync({
    url: `http://127.0.0.1:${porta}`,
    integracaoId: INTEGRACAO,
    segredo: SEGREDO,
  });

  let usuarioId: string;
  ({ siteId, usuarioId } = await garantirAdmin());
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  await comTransacao({ usuarioId }, async (c) => {
    base = await criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 12,
      vagasMoto: 1,
      vigenteDesde: new Date(Date.now() - 86_400_000),
    });
  });
});
beforeEach(() => {
  limitadorPorIp.limparTudo();
  chamadas.length = 0;
  responder = nuvemNormal;
});
afterAll(async () => {
  await trabalhador.parar();
  await new Promise((r) => nuvem.close(r));
  await fecharPool();
});

describe('envio para a API externa', () => {
  it('primeira conexão: carga completa assinada, só com dados públicos; os eventos anteriores ficam cobertos', async () => {
    const e = await entrada('SNP1A11');
    await ciclo();
    const snap = chamadas.find((c) => c.rota === '/sync/v1/snapshot')!;
    expect(snap.assinaturaOk).toBe(true);
    const p = snap.corpo as ParteSnapshotSync;
    expect(p).toMatchObject({ siteId, parte: 1, totalPartes: 1 });
    expect(p.site?.horasAcessoAposSaida).toBe(24);
    expect(p.tabelas?.[0]?.tarifas.length).toBeGreaterThan(0);
    expect(p.tickets?.map((t) => t.id)).toContain(e.sessao.id);
    expect(p.tickets?.[0]?.tokens[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    // Nada de token em claro, operador, formas de pagamento ou caixa
    const texto = JSON.stringify(p);
    expect(texto).not.toContain(e.acesso.link.split('#')[1]);
    expect(texto).not.toMatch(/operador|Ana Administradora|DINHEIRO|caixa|senha/i);
    expect(Number((await estado()).snapshot_pendente)).toBe(0);
    expect(await contar('PENDENTE')).toBe(0);
  });

  it('eventos novos vão em ordem de seq, com a projeção pública, e ficam confirmados', async () => {
    const e = await entrada('EVT2B22');
    await admin.post(`/api/v1/sessoes/${e.sessao.id}/novo-link`).expect(200);
    await ciclo();
    const push = chamadas.find((c) => c.rota === '/sync/v1/push')!;
    expect(push.assinaturaOk).toBe(true);
    const lote = push.corpo as LoteSync;
    expect(lote.siteId).toBe(siteId);
    const seqs = lote.eventos.map((x) => x.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(lote.eventos.map((x) => x.tipo)).toEqual(
      expect.arrayContaining(['ticket.aberto', 'vagas.disponibilidade', 'ticket.token_revogado']),
    );
    const revogado = lote.eventos.find((x) => x.tipo === 'ticket.token_revogado')!;
    expect(revogado.dados).toMatchObject({ tipo: 'ticket', ticket: { placa: 'EVT2B22' } });
    const tokens = (revogado.dados as { ticket: { tokens: { revogadoEm: string | null }[] } }).ticket.tokens;
    expect(tokens.map((k) => k.revogadoEm !== null)).toEqual([true, false]);
    expect(await contar('PENDENTE')).toBe(0);
    expect(Number((await estado()).ultimo_seq_confirmado)).toBe(Math.max(...seqs));
  });

  it('sem eventos: sinal de vida (lote vazio) a cada 15 s, não a cada ciclo', async () => {
    (trabalhador as unknown as { ultimoContato: number }).ultimoContato = 0;
    await ciclo();
    await ciclo();
    const vazios = chamadas.filter(
      (c) => c.rota === '/sync/v1/push' && (c.corpo as LoteSync).eventos.length === 0,
    );
    expect(vazios).toHaveLength(1);
  });

  it('nuvem fora do ar: nada se perde, tenta de novo com espera crescente e recupera sozinho', async () => {
    responder = () => ({ status: 503, corpo: { erro: { mensagem: 'Serviço indisponível' } } });
    await entrada('OFF3C33');
    await ciclo();
    let s = await estado();
    expect(Number(s.falhas_seguidas)).toBe(1);
    expect(s.ultimo_erro).toMatch(/indisponível/);
    const espera1 = (trabalhador as unknown as { esperarAte: number }).esperarAte - Date.now();
    expect(await contar('PENDENTE')).toBeGreaterThan(0);
    // Durante a espera não tenta (não sobrecarrega a nuvem)
    expect(await trabalhador.ciclo()).toBe(false);
    expect(chamadas.filter((c) => c.rota === '/sync/v1/push')).toHaveLength(1);
    await ciclo();
    const espera2 = (trabalhador as unknown as { esperarAte: number }).esperarAte - Date.now();
    expect(espera2).toBeGreaterThan(espera1);

    responder = nuvemNormal; // voltou
    await ciclo();
    s = await estado();
    expect(Number(s.falhas_seguidas)).toBe(0);
    expect(s.ultimo_erro).toBeNull();
    expect(await contar('PENDENTE')).toBe(0);
  });

  it('evento recusado pela nuvem vai para a dead-letter e aparece no painel; os outros seguem', async () => {
    responder = (rota, corpo) => {
      const lote = corpo as LoteSync;
      return { status: 200, corpo: respostaPush(lote, [lote.eventos[0]!.eventId]) };
    };
    await entrada('REJ4D44');
    await ciclo();
    expect(await contar('REJEITADO')).toBe(1);
    expect(await contar('PENDENTE')).toBe(0);
    const st = (await admin.get('/api/v1/sync/status').expect(200)).body;
    expect(st.rejeitados[0]).toMatchObject({
      tipo: 'ticket.aberto',
      erro: expect.stringMatching(/placa inválida/),
    });
  });

  it('nuvem sem os dados do estacionamento (409): refaz a carga completa', async () => {
    let primeira = true;
    responder = (rota, corpo) => {
      if (rota.endsWith('/push') && primeira) {
        primeira = false;
        return { status: 409, corpo: { erro: { codigo: 'CONFLITO', mensagem: 'envie a carga completa' } } };
      }
      return nuvemNormal(rota, corpo);
    };
    await entrada('CNF5E55');
    await ciclo();
    expect(Number((await estado()).snapshot_pendente)).toBe(1);
    await ciclo();
    expect(chamadas.map((c) => c.rota)).toContain('/sync/v1/snapshot');
    expect(Number((await estado()).snapshot_pendente)).toBe(0);
  });

  it('credencial recusada (401): espera longa e mensagem clara no painel', async () => {
    responder = () => ({ status: 401, corpo: { erro: { mensagem: 'Credencial da integração inválida' } } });
    await entrada('CRD6F66');
    await ciclo();
    const espera = (trabalhador as unknown as { esperarAte: number }).esperarAte - Date.now();
    expect(espera).toBeGreaterThan(40_000);
    const st = (await admin.get('/api/v1/sync/status').expect(200)).body;
    // (aqui o .env de teste não liga o envio automático: a situação geral fica DESLIGADA)
    expect(st).toMatchObject({ falhasSeguidas: 1, ultimoErro: expect.stringMatching(/SYNC_SECRET/) });
    responder = nuvemNormal;
    await ciclo();
  });

  it('"Ressincronizar" no painel agenda uma nova carga completa', async () => {
    await admin.post('/api/v1/sync/ressincronizar').expect(200);
    expect(Number((await estado()).snapshot_pendente)).toBe(1);
    await ciclo();
    expect(chamadas.map((c) => c.rota)).toContain('/sync/v1/snapshot');
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM historico_atividades WHERE acao = 'sync.ressincronizar'",
    );
    expect(Number(h?.n)).toBe(1);
  });
});
