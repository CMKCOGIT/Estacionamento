import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CABECALHOS_INTEGRACAO as H,
  formaDeConferencia,
  textoParaAssinar,
  type LoteSync,
  type PedidoConferenciaSync,
  type RespostaConferenciaSync,
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
let conferencia: (corpo: PedidoConferenciaSync) => RespostaConferenciaSync = (c) => ({
  divergentes: [],
  sobrando: [],
  conferidos: c.itens.length,
});
const nuvemNormal = (rota: string, corpo: unknown) =>
  rota.endsWith('/conferir')
    ? { status: 200, corpo: conferencia(corpo as PedidoConferenciaSync) }
    : rota.endsWith('/snapshot')
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
      res
        .writeHead(r.status, { 'Content-Type': 'application/json', 'X-Request-Id': randomUUID() })
        .end(JSON.stringify(r.corpo));
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
      vagasCarro: 30,
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
      if (!rota.endsWith('/push') || !(corpo as LoteSync).eventos.length) return nuvemNormal(rota, corpo);
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

describe('detecção de alterações, conferência e status de cada sincronização', () => {
  const impressao = (v: unknown) =>
    createHash('sha256').update(formaDeConferencia('ticket', v)).digest('hex');
  const eventosDo = (id: string) =>
    pool.query<RowDataPacket[]>(
      'SELECT tipo, origem, status, resultado_nuvem, payload FROM sync_outbox WHERE agregado_id = ? ORDER BY seq',
      [id],
    );

  it('ação pelo sistema não deixa marca (o evento já cobre a alteração)', async () => {
    const e = await entrada('MRC1A11');
    const [m] = await pool.query<RowDataPacket[]>('SELECT * FROM sync_marcas WHERE agregado_id = ?', [
      e.sessao.id,
    ]);
    expect(m).toHaveLength(0);
    await ciclo();
  });

  it('alteração feita direto no banco (fora do sistema) é detectada e enviada', async () => {
    const e = await entrada('DET2B22');
    await ciclo();
    // Correção manual, sem passar pelos serviços: link revogado direto no banco
    const [[u]] = await pool.query<RowDataPacket[]>('SELECT id FROM usuarios LIMIT 1');
    await pool.query(
      "UPDATE sessao_tokens SET revogado_em = NOW(3), revogado_por = ?, motivo_revogacao = 'correção manual' WHERE sessao_id = ?",
      [u!.id, e.sessao.id],
    );
    const [[m]] = await pool.query<RowDataPacket[]>('SELECT tipo FROM sync_marcas WHERE agregado_id = ?', [
      e.sessao.id,
    ]);
    expect(m?.tipo).toBe('ticket');
    await ciclo(); // detecta e gera o evento
    await ciclo(); // envia
    const [ev] = await eventosDo(e.sessao.id);
    const ultimo = ev.at(-1)!;
    expect(ultimo).toMatchObject({ tipo: 'ticket.alterado', origem: 'DETECCAO', status: 'ENVIADO' });
    expect(ultimo.payload.ticket.tokens.every((k: { revogadoEm: string | null }) => k.revogadoEm)).toBe(true);
    const [restantes] = await pool.query<RowDataPacket[]>('SELECT * FROM sync_marcas WHERE agregado_id = ?', [
      e.sessao.id,
    ]);
    expect(restantes).toHaveLength(0);
    const enviado = chamadas.flatMap((c) => (c.rota.endsWith('/push') ? (c.corpo as LoteSync).eventos : []));
    expect(enviado.some((x) => x.tipo === 'ticket.alterado')).toBe(true);
  });

  it('vagas alteradas direto no banco: a disponibilidade é reenviada', async () => {
    const [[u]] = await pool.query<RowDataPacket[]>('SELECT id FROM usuarios LIMIT 1');
    await pool.query(
      `UPDATE vagas SET situacao = 'MANUTENCAO', motivo_bloqueio = 'teste', bloqueada_em = NOW(3), bloqueada_por = ?
        WHERE site_id = ? AND situacao = 'ATIVA'
          AND id NOT IN (SELECT vaga_ocupada_id FROM sessoes_estacionamento WHERE vaga_ocupada_id IS NOT NULL)
        LIMIT 1`,
      [u!.id, siteId],
    );
    (trabalhador as unknown as { ultimaVigilancia: number }).ultimaVigilancia = 0;
    await ciclo();
    await ciclo();
    const [[ev]] = await pool.query<RowDataPacket[]>(
      "SELECT origem, status FROM sync_outbox WHERE tipo = 'vagas.disponibilidade' ORDER BY seq DESC LIMIT 1",
    );
    expect(ev).toMatchObject({ origem: 'DETECCAO', status: 'ENVIADO' });
  });

  it('cada evento guarda o resultado na nuvem; cada envio guarda o id da requisição', async () => {
    responder = (rota, corpo) => {
      const r = nuvemNormal(rota, corpo);
      if (rota.endsWith('/push') && (corpo as LoteSync).eventos.length)
        (r.corpo as unknown as { resultados: unknown[] }).resultados = (corpo as LoteSync).eventos.map(
          (x) => ({
            eventId: x.eventId,
            resultado: 'REPETIDO',
          }),
        );
      return r;
    };
    const e = await entrada('RES3C33');
    await ciclo();
    const [ev] = await eventosDo(e.sessao.id);
    expect(ev.map((x) => x.resultado_nuvem)).toEqual(ev.map(() => 'REPETIDO'));
    const [[x]] = await pool.query<RowDataPacket[]>(
      "SELECT requisicao_id, detalhes FROM sync_execucoes WHERE tipo = 'PUSH' AND sucesso ORDER BY id DESC LIMIT 1",
    );
    expect(x?.requisicao_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(x?.detalhes).toMatchObject({ aplicados: expect.any(Number) });
  });

  it('conferência: manda a impressão digital do estado atual; corrige o diferente e remove o que sobrou', async () => {
    const e = await entrada('CNF4D44');
    await ciclo();
    const inexistente = '01JNAOEXISTENOLOCAL0000000';
    let pedido: PedidoConferenciaSync | null = null;
    conferencia = (c) => {
      pedido = c;
      return {
        divergentes: [{ tipo: 'ticket', id: e.sessao.id, motivo: 'DIFERENTE' }],
        sobrando: [{ tipo: 'ticket', id: inexistente }],
        conferidos: c.itens.length,
      };
    };
    await admin.post('/api/v1/sync/conferir').expect(200);
    await ciclo(); // confere e gera as correções
    await ciclo(); // envia as correções
    conferencia = (c) => ({ divergentes: [], sobrando: [], conferidos: c.itens.length });

    // A impressão digital é a do estado atual (a mesma que a nuvem calcula do que recebeu)
    const item = pedido!.itens.find((i) => i.id === e.sessao.id)!;
    const [ev] = await eventosDo(e.sessao.id);
    expect(item.hash).toBe(impressao(ev.at(-1)!.payload.ticket));
    expect(pedido!.itens.map((i) => i.tipo)).toEqual(
      expect.arrayContaining(['site', 'disponibilidade', 'tabela_tarifa', 'ticket']),
    );
    expect(ev.at(-1)).toMatchObject({ tipo: 'ticket.corrigido', origem: 'CONFERENCIA', status: 'ENVIADO' });
    const [[removido]] = await pool.query<RowDataPacket[]>(
      "SELECT tipo, payload FROM sync_outbox WHERE agregado_id = ? AND tipo = 'ticket.removido'",
      [inexistente],
    );
    expect(removido?.payload).toEqual({ tipo: 'ticket_removido', ticketId: inexistente });

    const st = (await admin.get('/api/v1/sync/status').expect(200)).body;
    expect(st).toMatchObject({ ultimaConferenciaDivergencias: 2, conferenciaPendente: false });
    expect(st.historico.find((h: { tipo: string }) => h.tipo === 'CONFERENCIA')).toMatchObject({
      sucesso: true,
      detalhes: { divergentes: [expect.objectContaining({ motivo: 'DIFERENTE' })] },
    });
  });

  it('sem internet: o sistema funciona, as operações ficam na fila com tentativas; ao voltar, tudo vai uma vez só', async () => {
    responder = () => {
      throw new Error('sem rede');
    };
    nuvem.closeAllConnections();
    const porta = (nuvem.address() as AddressInfo).port;
    await new Promise((r) => nuvem.close(r));
    // Operação normal com a nuvem fora
    const e1 = await entrada('OFF5E55');
    const e2 = await entrada('OFF5E66');
    await admin.post(`/api/v1/sessoes/${e2.sessao.id}/novo-link`).expect(200);
    await ciclo();
    await ciclo();
    const [pend] = await pool.query<RowDataPacket[]>(
      "SELECT event_id, tentativas, proxima_tentativa_em, ultimo_erro FROM sync_outbox WHERE status = 'PENDENTE'",
    );
    expect(pend.length).toBeGreaterThanOrEqual(3);
    expect(
      pend.every((p) => Number(p.tentativas) >= 1 && p.proxima_tentativa_em && /conexão/.test(p.ultimo_erro)),
    ).toBe(true);
    const ids = pend.map((p) => p.event_id);
    // Internet de volta (mesma porta): retoma sozinho
    responder = nuvemNormal;
    await new Promise<void>((r) => nuvem.listen(porta, '127.0.0.1', r));
    chamadas.length = 0;
    for (let i = 0; i < 3; i++) await ciclo();
    expect(await contar('PENDENTE')).toBe(0);
    const enviados = chamadas.flatMap((c) => (c.rota.endsWith('/push') ? (c.corpo as LoteSync).eventos : []));
    const vezes = ids.map((id) => enviados.filter((x) => x.eventId === id).length);
    expect(vezes.every((n) => n === 1)).toBe(true); // cada evento uma vez só
    expect(enviados.some((x) => x.agregado.id === e1.sessao.id)).toBe(true);
    expect(Number((await estado()).falhas_seguidas)).toBe(0);
  }, 30_000);
});
