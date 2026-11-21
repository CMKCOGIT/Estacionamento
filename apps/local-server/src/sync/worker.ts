import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import type {
  EventoSync,
  LoteSync,
  ParteSnapshotSync,
  ProjecaoTabelaTarifa,
  ProjecaoTicket,
  RespostaPushSync,
  RespostaSnapshotSync,
} from '@estacionamento/shared';
import { logger } from '../config/logger.js';
import { obterSiteAtual } from '../config/site.js';
import { pool } from '../db/pool.js';
import { chamarNuvem, FalhaDeRede, type CredencialSync } from './cliente.js';
import {
  projecaoDisponibilidade,
  projecaoSite,
  projecaoTabelaTarifa,
  projecaoTicket,
  tabelasPublicadasVisiveis,
  ticketsVisiveis,
} from './projecoes.js';

/** Até 100 eventos ou ~450 KB por lote (a nuvem aceita 512 KB). */
const MAX_EVENTOS = 100;
const MAX_BYTES = 450_000;
const TICKETS_POR_PARTE = 150;
/** Evento só é lido depois de 1 s: as transações que ainda vão gravar seq menores já terminaram. */
const ASSENTAR_SEGUNDOS = 1;
/** Lote inválido (erro do formato, não da rede): depois de N tentativas vai para a dead-letter. */
const MAX_TENTATIVAS_INVALIDO = 3;

class ErroSync extends Error {
  constructor(
    mensagem: string,
    readonly tipo: 'REDE' | 'CREDENCIAL' | 'INVALIDO' | 'SERVIDOR',
    readonly status: number | null = null,
  ) {
    super(mensagem);
  }
}

export interface OpcoesTrabalhador {
  /** Intervalo da verificação de eventos novos (ARQUITETURA §6.3: frequente + a cada 15 s). */
  intervaloMs?: number;
  /** Sem eventos, envia um lote vazio (sinal de vida) a cada... */
  sinalDeVidaMs?: number;
}

/**
 * Worker de sincronização: envia a fila `sync_outbox` para a API externa.
 *  - primeira conexão (ou "Ressincronizar" no painel): carga completa;
 *  - depois, lotes de eventos em ordem de `seq`, com confirmação de cada um;
 *  - sem eventos: sinal de vida a cada 15 s (o app do cliente avisa quando
 *    o estacionamento para de enviar dados);
 *  - falha de rede ou da nuvem: novas tentativas com espera crescente e
 *    variação aleatória (2 s → 1 min sem rede; até 5 min com a nuvem com erro). A operação local nunca espera a nuvem;
 *  - evento recusado pela nuvem: dead-letter (status REJEITADO) e aviso no painel.
 */
export class TrabalhadorSync {
  private timer: NodeJS.Timeout | null = null;
  private emCiclo: Promise<void> | null = null;
  private parado = true;
  private esperarAte = 0;
  private ultimoContato = 0;
  private ultimaFaxina = 0;
  private readonly intervaloMs: number;
  private readonly sinalDeVidaMs: number;

  constructor(
    private readonly cred: CredencialSync,
    opcoes: OpcoesTrabalhador = {},
  ) {
    this.intervaloMs = opcoes.intervaloMs ?? 3_000;
    this.sinalDeVidaMs = opcoes.sinalDeVidaMs ?? 15_000;
  }

  iniciar() {
    this.parado = false;
    this.agendar(500);
  }

  async parar() {
    this.parado = true;
    if (this.timer) clearTimeout(this.timer);
    await this.emCiclo;
  }

  /** Antecipa o próximo envio (ex.: "Ressincronizar" no painel). */
  acordar() {
    this.esperarAte = 0;
    this.ultimoContato = 0;
    if (!this.parado) this.agendar(0);
  }

  private agendar(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.emCiclo = this.ciclo()
        .then((maisPendentes) => {
          if (!this.parado) this.agendar(maisPendentes ? 200 : this.intervaloMs);
        })
        .finally(() => {
          this.emCiclo = null;
        });
    }, ms);
    this.timer.unref();
  }

  /** Um ciclo completo. Devolve true se ainda há eventos esperando (envia o próximo lote já). */
  async ciclo(): Promise<boolean> {
    if (Date.now() < this.esperarAte) return false;
    let siteId: string;
    try {
      siteId = (await obterSiteAtual()).id;
      await pool.query('INSERT IGNORE INTO sync_estado (site_id) VALUES (?)', [siteId]);
    } catch (erro) {
      logger.debug({ err: erro }, 'Sincronização: banco local indisponível');
      return false;
    }
    try {
      const [[estado]] = await pool.query<RowDataPacket[]>(
        'SELECT snapshot_pendente FROM sync_estado WHERE site_id = ?',
        [siteId],
      );
      if (Number(estado?.snapshot_pendente)) await this.enviarSnapshot(siteId);
      const mais = await this.enviarEventos(siteId);
      await this.faxina();
      return mais;
    } catch (erro) {
      await this.registrarFalha(siteId, erro);
      return false;
    }
  }

  private async enviarEventos(siteId: string): Promise<boolean> {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT seq, event_id, tipo, versao, agregado_tipo, agregado_id, payload, ocorrido_em, tentativas
         FROM sync_outbox
        WHERE site_id = ? AND status = 'PENDENTE' AND versao >= 2 AND criado_em <= NOW(3) - INTERVAL ? SECOND
        ORDER BY seq LIMIT ?`,
      [siteId, ASSENTAR_SEGUNDOS, MAX_EVENTOS],
    );
    const eventos: EventoSync[] = [];
    let bytes = 0;
    for (const l of linhas) {
      const e: EventoSync = {
        eventId: String(l.event_id),
        seq: Number(l.seq),
        tipo: String(l.tipo),
        versao: Number(l.versao),
        ocorridoEm: (l.ocorrido_em as Date).toISOString(),
        agregado: { tipo: String(l.agregado_tipo), id: String(l.agregado_id) },
        dados: typeof l.payload === 'string' ? JSON.parse(l.payload) : l.payload,
      };
      bytes += JSON.stringify(e).length;
      if (eventos.length && bytes > MAX_BYTES) break;
      eventos.push(e);
    }
    if (!eventos.length && Date.now() - this.ultimoContato < this.sinalDeVidaMs) return false;

    const inicio = Date.now();
    const lote: LoteSync = { siteId, eventos };
    const r = await this.chamar<RespostaPushSync>('POST', '/sync/v1/push', lote, eventos);
    if (r === 'CONFLITO') {
      // A nuvem ainda não conhece o estacionamento (ou perdeu os dados): carga completa primeiro
      await pool.query('UPDATE sync_estado SET snapshot_pendente = TRUE WHERE site_id = ?', [siteId]);
      this.ultimoContato = 0;
      return true;
    }
    const rejeitados = new Map(r.rejeitados.map((x) => [x.eventId, x.motivo]));
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const aceitos = eventos.filter((e) => !rejeitados.has(e.eventId)).map((e) => e.eventId);
      if (aceitos.length) {
        await c.query(
          `UPDATE sync_outbox SET status = 'ENVIADO', enviado_em = NOW(3), tentativas = tentativas + 1, ultimo_erro = NULL
            WHERE event_id IN (?) AND status = 'PENDENTE'`,
          [aceitos],
        );
      }
      for (const [eventId, motivo] of rejeitados) {
        await c.query(
          `UPDATE sync_outbox SET status = 'REJEITADO', enviado_em = NOW(3), tentativas = tentativas + 1, ultimo_erro = ?
            WHERE event_id = ? AND status = 'PENDENTE'`,
          [`Recusado pela nuvem: ${motivo}`.slice(0, 1000), eventId],
        );
      }
      await c.query(
        `UPDATE sync_estado SET ultimo_seq_confirmado = GREATEST(ultimo_seq_confirmado, ?), ultimo_push_em = NOW(3),
           ultimo_sucesso_em = NOW(3), ultimo_contato_em = NOW(3), falhas_seguidas = 0, ultimo_erro = NULL
          WHERE site_id = ?`,
        [eventos.reduce((m, e) => Math.max(m, e.seq), 0), siteId],
      );
      if (eventos.length) await execucao(c, siteId, 'PUSH', inicio, true, eventos, 200, null);
      await c.commit();
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
    this.ultimoContato = Date.now();
    if (rejeitados.size)
      logger.warn({ rejeitados: [...rejeitados.values()] }, 'Sincronização: eventos recusados pela nuvem');
    if (eventos.length) logger.debug({ eventos: eventos.length }, 'Sincronização: lote enviado');
    return linhas.length === MAX_EVENTOS || eventos.length < linhas.length;
  }

  /** Ressincronização completa: o estado atual inteiro, lido numa fotografia consistente do banco. */
  private async enviarSnapshot(siteId: string) {
    const inicio = Date.now();
    const c = await pool.getConnection();
    let partes: ParteSnapshotSync[];
    let seq: number;
    try {
      await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const [[m]] = await c.query<RowDataPacket[]>(
        'SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_outbox WHERE site_id = ?',
        [siteId],
      );
      seq = Number(m?.seq ?? 0);
      const snapshotId = ulid();
      const site = await projecaoSite(c, siteId);
      const disponibilidade = await projecaoDisponibilidade(c, siteId);
      const tabelas: ProjecaoTabelaTarifa[] = [];
      for (const id of await tabelasPublicadasVisiveis(c, siteId))
        tabelas.push(await projecaoTabelaTarifa(c, id));
      const tickets: ProjecaoTicket[] = [];
      for (const id of await ticketsVisiveis(c, siteId)) tickets.push(await projecaoTicket(c, id));
      await c.commit();
      const grupos: (typeof tickets)[] = [];
      for (let i = 0; i < tickets.length; i += TICKETS_POR_PARTE)
        grupos.push(tickets.slice(i, i + TICKETS_POR_PARTE));
      if (!grupos.length) grupos.push([]);
      partes = grupos.map((g, i) => ({
        siteId,
        snapshotId,
        parte: i + 1,
        totalPartes: grupos.length,
        seq,
        ...(i === 0 ? { site, disponibilidade, tabelas } : {}),
        tickets: g,
      }));
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }

    for (const p of partes) {
      const r = await this.chamar<RespostaSnapshotSync>('POST', '/sync/v1/snapshot', p, []);
      if (r === 'CONFLITO')
        throw new ErroSync('A nuvem recusou a carga completa (recomeçando).', 'SERVIDOR', 409);
    }
    const t = await pool.getConnection();
    try {
      await t.beginTransaction();
      // Eventos até a fotografia já estão cobertos pela carga completa
      await t.query(
        `UPDATE sync_outbox SET status = 'ENVIADO', enviado_em = NOW(3), ultimo_erro = 'Coberto pela carga completa'
          WHERE site_id = ? AND status = 'PENDENTE' AND seq <= ?`,
        [siteId, seq],
      );
      await t.query(
        `UPDATE sync_estado SET snapshot_pendente = FALSE, ultimo_snapshot_em = NOW(3), ultimo_sucesso_em = NOW(3),
           ultimo_contato_em = NOW(3), ultimo_seq_confirmado = GREATEST(ultimo_seq_confirmado, ?), falhas_seguidas = 0,
           ultimo_erro = NULL WHERE site_id = ?`,
        [seq, siteId],
      );
      await execucao(
        t,
        siteId,
        'SNAPSHOT',
        inicio,
        true,
        [],
        200,
        null,
        partes.reduce((n, p) => n + (p.tickets?.length ?? 0), 0),
      );
      await t.commit();
    } catch (e) {
      await t.rollback().catch(() => undefined);
      throw e;
    } finally {
      t.release();
    }
    this.ultimoContato = Date.now();
    logger.info(
      { tickets: partes.reduce((n, p) => n + (p.tickets?.length ?? 0), 0), partes: partes.length },
      'Sincronização: carga completa enviada à nuvem',
    );
  }

  private async chamar<T>(
    metodo: 'POST',
    rota: string,
    corpo: unknown,
    eventos: EventoSync[],
  ): Promise<T | 'CONFLITO'> {
    let r;
    try {
      r = await chamarNuvem<T>(this.cred, metodo, rota, corpo);
    } catch (e) {
      if (e instanceof FalhaDeRede) throw new ErroSync(e.message, 'REDE');
      throw e;
    }
    if (r.status >= 200 && r.status < 300 && r.corpo) return r.corpo;
    if (r.status === 409) return 'CONFLITO';
    if (r.status === 401 || r.status === 403)
      throw new ErroSync(
        `A nuvem recusou a credencial (${r.erro}). Confira SYNC_INTEGRACAO_ID e SYNC_SECRET.`,
        'CREDENCIAL',
        r.status,
      );
    if (r.status === 400 || r.status === 413) {
      // Formato recusado: conta tentativas; depois de algumas, os eventos vão para a dead-letter
      if (eventos.length) {
        await pool.query(
          `UPDATE sync_outbox SET tentativas = tentativas + 1, ultimo_erro = ?,
             status = IF(tentativas >= ?, 'REJEITADO', status), enviado_em = IF(tentativas >= ?, NOW(3), enviado_em)
            WHERE event_id IN (?) AND status = 'PENDENTE'`,
          [
            `Lote recusado: ${r.erro}`.slice(0, 1000),
            MAX_TENTATIVAS_INVALIDO,
            MAX_TENTATIVAS_INVALIDO,
            eventos.map((e) => e.eventId),
          ],
        );
      }
      throw new ErroSync(`A nuvem recusou os dados enviados: ${r.erro}`, 'INVALIDO', r.status);
    }
    throw new ErroSync(`API externa indisponível: ${r.erro}`, 'SERVIDOR', r.status);
  }

  private async registrarFalha(siteId: string, erro: unknown) {
    const e = erro instanceof ErroSync ? erro : new ErroSync((erro as Error).message, 'SERVIDOR');
    try {
      const [[estado]] = await pool.query<RowDataPacket[]>(
        'SELECT falhas_seguidas FROM sync_estado WHERE site_id = ?',
        [siteId],
      );
      const falhas = Number(estado?.falhas_seguidas ?? 0) + 1;
      // Espera crescente com variação aleatória: 2 s, 4 s, 8 s... até 1 min sem rede, 5 min com a
      // nuvem com erro (não sobrecarrega quem está se recuperando); credencial errada: 1 a 10 min
      const base = e.tipo === 'CREDENCIAL' ? 60_000 : 2_000;
      const teto = e.tipo === 'CREDENCIAL' ? 600_000 : e.tipo === 'REDE' ? 60_000 : 300_000;
      const espera = Math.min(teto, base * 2 ** Math.min(falhas - 1, 10));
      this.esperarAte = Date.now() + espera * (0.8 + Math.random() * 0.4);
      await pool.query(
        `UPDATE sync_estado SET falhas_seguidas = ?, ultimo_erro = ?, ultimo_erro_em = NOW(3) WHERE site_id = ?`,
        [falhas, e.message.slice(0, 1000), siteId],
      );
      await execucao(pool, siteId, 'PUSH', Date.now(), false, [], e.status, e.message);
      (falhas === 1 || falhas % 20 === 0 ? logger.warn.bind(logger) : logger.debug.bind(logger))(
        { falhas, proximaTentativaEmS: Math.round(espera / 1000) },
        `Sincronização: ${e.message}`,
      );
    } catch {
      this.esperarAte = Date.now() + 30_000;
    }
  }

  /** Retenção (ARQUITETURA §9): eventos já enviados e o histórico de execuções saem depois de 30 dias. */
  private async faxina() {
    if (Date.now() - this.ultimaFaxina < 3_600_000) return;
    this.ultimaFaxina = Date.now();
    await pool.query(
      "DELETE FROM sync_outbox WHERE status = 'ENVIADO' AND enviado_em < NOW(3) - INTERVAL 30 DAY LIMIT 5000",
    );
    await pool.query('DELETE FROM sync_execucoes WHERE iniciado_em < NOW(3) - INTERVAL 30 DAY LIMIT 5000');
  }
}

async function execucao(
  c: PoolConnection | typeof pool,
  siteId: string,
  tipo: 'PUSH' | 'SNAPSHOT',
  inicio: number,
  sucesso: boolean,
  eventos: EventoSync[],
  status: number | null,
  erro: string | null,
  itens = eventos.length,
) {
  await c.query(
    `INSERT INTO sync_execucoes (site_id, tipo, iniciado_em, finalizado_em, sucesso, itens, primeiro_seq, ultimo_seq, http_status, duracao_ms, erro)
     VALUES (?, ?, ?, NOW(3), ?, ?, ?, ?, ?, ?, ?)`,
    [
      siteId,
      tipo,
      new Date(inicio),
      sucesso,
      itens,
      eventos[0]?.seq ?? null,
      eventos.at(-1)?.seq ?? null,
      status,
      Date.now() - inicio,
      erro?.slice(0, 1000) ?? null,
    ],
  );
}
