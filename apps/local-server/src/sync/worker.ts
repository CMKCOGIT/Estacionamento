import { createHash } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import {
  formaDeConferencia,
  type EventoSync,
  type LoteSync,
  type ParteSnapshotSync,
  type PedidoConferenciaSync,
  type ProjecaoTabelaTarifa,
  type ProjecaoTicket,
  type RespostaConferenciaSync,
  type RespostaPushSync,
  type RespostaSnapshotSync,
  type TipoItemConferencia,
} from '@estacionamento/shared';
import { logger } from '../config/logger.js';
import { obterSiteAtual } from '../config/site.js';
import { pool } from '../db/pool.js';
import { chamarNuvem, FalhaDeRede, type CredencialSync } from './cliente.js';
import {
  publicarDisponibilidade,
  publicarSite,
  publicarTabelaTarifa,
  publicarTicket,
  registrarEvento,
} from './outbox.js';
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
/** Evento/marca só é lido depois de 1 s: as transações que ainda vão gravar seq menores já terminaram. */
const ASSENTAR_SEGUNDOS = 1;
/** Lote inválido (erro do formato, não da rede): depois de N tentativas vai para a dead-letter. */
const MAX_TENTATIVAS_INVALIDO = 3;
/** Marcas convertidas em eventos por ciclo. */
const MARCAS_POR_CICLO = 100;

type Etapa = 'PUSH' | 'SNAPSHOT' | 'CONFERENCIA';
type Origem = 'DETECCAO' | 'CONFERENCIA';

class ErroSync extends Error {
  constructor(
    mensagem: string,
    readonly tipo: 'REDE' | 'CREDENCIAL' | 'INVALIDO' | 'SERVIDOR',
    readonly status: number | null = null,
    readonly requisicaoId: string | null = null,
  ) {
    super(mensagem);
  }
}

export interface OpcoesTrabalhador {
  /** Intervalo da verificação de eventos novos (ARQUITETURA §6.3: frequente + a cada 15 s). */
  intervaloMs?: number;
  /** Sem eventos, envia um lote vazio (sinal de vida) a cada... */
  sinalDeVidaMs?: number;
  /** Conferência entre os bancos a cada... (padrão: 10 min). */
  conferenciaMs?: number;
}

/** Impressão digital de um item: a nuvem faz a mesma conta com o que tem gravado. */
const impressao = (tipo: TipoItemConferencia, v: unknown) =>
  createHash('sha256').update(formaDeConferencia(tipo, v)).digest('hex');

/**
 * Worker de sincronização (servidor local → API externa).
 *
 * Cada ciclo:
 *  1. carga completa, se pendente (primeira conexão, nuvem sem os dados ou
 *     "Ressincronizar" no painel);
 *  2. DETECÇÃO: alterações marcadas pelos triggers do banco (sync_marcas) e
 *     ainda sem evento viram eventos com o estado atual;
 *  3. disponibilidade de vagas: conferida a cada sinal de vida, enviada se mudou;
 *  4. ENVIO da fila (sync_outbox) em lotes em ordem de seq, com o resultado de
 *     cada evento; sem eventos, sinal de vida a cada 15 s;
 *  5. CONFERÊNCIA com a nuvem a cada 10 min (fila vazia): o que estiver
 *     diferente, faltando ou sobrando lá é corrigido a partir do local.
 *
 * Falhas: espera crescente com variação aleatória (2 s → 1 min sem rede; até
 * 5 min com a nuvem com erro). Nada se perde: a fila fica no banco local e o
 * envio recomeça sozinho. A operação do estacionamento nunca espera a nuvem.
 */
export class TrabalhadorSync {
  private timer: NodeJS.Timeout | null = null;
  private emCiclo: Promise<void> | null = null;
  private parado = true;
  private esperarAte = 0;
  private ultimoContato = 0;
  private ultimaFaxina = 0;
  private ultimaConferencia = 0;
  private ultimaVigilancia = 0;
  private etapa: Etapa = 'PUSH';
  private inicioEtapa = Date.now();
  private readonly intervaloMs: number;
  private readonly sinalDeVidaMs: number;
  private readonly conferenciaMs: number;

  constructor(
    private readonly cred: CredencialSync,
    opcoes: OpcoesTrabalhador = {},
  ) {
    this.intervaloMs = opcoes.intervaloMs ?? 3_000;
    this.sinalDeVidaMs = opcoes.sinalDeVidaMs ?? 15_000;
    this.conferenciaMs = opcoes.conferenciaMs ?? 10 * 60_000;
    // Primeira conferência ~1 min depois de ligar (a carga completa vem antes)
    this.ultimaConferencia = Date.now() - this.conferenciaMs + 60_000;
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

  /** Antecipa o próximo envio (ex.: "Ressincronizar" ou "Conferir agora" no painel). */
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

  /** Um ciclo completo. Devolve true se ainda há trabalho esperando (roda o próximo já). */
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
      // Etapas locais (não dependem da internet): detecção e vigilância das vagas
      const maisMarcas = await this.converterMarcas(siteId);
      if (Date.now() - this.ultimaVigilancia >= this.sinalDeVidaMs) {
        this.ultimaVigilancia = Date.now();
        await this.vigiarDisponibilidade(siteId);
      }

      const [[estado]] = await pool.query<RowDataPacket[]>(
        'SELECT snapshot_pendente, conferencia_pendente FROM sync_estado WHERE site_id = ?',
        [siteId],
      );
      if (Number(estado?.snapshot_pendente)) {
        this.etapa = 'SNAPSHOT';
        this.inicioEtapa = Date.now();
        await this.enviarSnapshot(siteId);
      }
      this.etapa = 'PUSH';
      this.inicioEtapa = Date.now();
      const maisEventos = await this.enviarEventos(siteId);
      if (
        !maisEventos &&
        !maisMarcas &&
        (Number(estado?.conferencia_pendente) || Date.now() - this.ultimaConferencia >= this.conferenciaMs)
      ) {
        this.etapa = 'CONFERENCIA';
        this.inicioEtapa = Date.now();
        await this.conferir(siteId);
      }
      await this.faxina();
      return maisEventos || maisMarcas;
    } catch (erro) {
      await this.registrarFalha(siteId, erro);
      return false;
    }
  }

  /**
   * DETECÇÃO pelo banco: cada marca é uma alteração sem evento (feita por
   * fora dos serviços). Gera o evento com o estado atual; a marca some junto
   * (registrarEvento apaga), na mesma transação.
   */
  private async converterMarcas(siteId: string): Promise<boolean> {
    const [marcas] = await pool.query<RowDataPacket[]>(
      `SELECT tipo, agregado_id FROM sync_marcas
        WHERE site_id = ? AND marcado_em <= NOW(3) - INTERVAL ? SECOND
        ORDER BY marcado_em LIMIT ?`,
      [siteId, ASSENTAR_SEGUNDOS, MARCAS_POR_CICLO],
    );
    for (const m of marcas) {
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [[ainda]] = await c.query<RowDataPacket[]>(
          'SELECT 1 FROM sync_marcas WHERE tipo = ? AND agregado_id = ? FOR UPDATE',
          [m.tipo, m.agregado_id],
        );
        if (ainda) await this.publicarAtual(c, siteId, String(m.tipo), String(m.agregado_id), 'DETECCAO');
        await c.commit();
      } catch (e) {
        await c.rollback().catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    }
    if (marcas.length)
      logger.debug({ marcas: marcas.length }, 'Sincronização: alterações detectadas no banco');
    return marcas.length === MARCAS_POR_CICLO;
  }

  /**
   * Gera o evento com o estado ATUAL de um item (detecção ou correção da
   * conferência). O servidor local é a fonte da verdade: o que não existe mais
   * aqui é removido de lá.
   */
  private async publicarAtual(c: PoolConnection, siteId: string, tipo: string, id: string, origem: Origem) {
    const nomeEvento = origem === 'DETECCAO' ? 'alterado' : 'corrigido';
    const apagarMarca = () =>
      c.query('DELETE FROM sync_marcas WHERE tipo = ? AND agregado_id = ?', [tipo, id]);
    if (tipo === 'ticket') {
      const [[t]] = await c.query<RowDataPacket[]>(
        `SELECT s.status, (s.status = 'ABERTA'
            OR COALESCE(s.saida_em, s.cancelado_em) >= NOW(3) - INTERVAL 1 HOUR
            OR EXISTS (SELECT 1 FROM sessao_tokens k WHERE k.sessao_id = s.id AND k.revogado_em IS NULL AND k.expira_em > NOW(3))
          ) AS visivel
           FROM sessoes_estacionamento s WHERE s.id = ? AND s.site_id = ?`,
        [id, siteId],
      );
      if (!t) {
        await registrarEvento(c, {
          siteId,
          tipo: 'ticket.removido',
          agregadoTipo: 'ticket',
          agregadoId: id,
          payload: { tipo: 'ticket_removido', ticketId: id },
          origem,
        });
      } else if (Number(t.visivel) || origem === 'CONFERENCIA') {
        await publicarTicket(c, siteId, `ticket.${nomeEvento}`, id, origem);
      } else {
        // Ticket antigo, sem link válido: o cliente não o vê mais, nada a enviar
        await apagarMarca();
      }
    } else if (tipo === 'disponibilidade') {
      await publicarDisponibilidade(c, siteId, origem);
    } else if (tipo === 'site') {
      await publicarSite(c, siteId, origem);
    } else if (tipo === 'tabela_tarifa') {
      const visiveis = await tabelasPublicadasVisiveis(c, siteId);
      if (visiveis.includes(id)) {
        await publicarTabelaTarifa(c, siteId, id, origem);
      } else {
        const [[tab]] = await c.query<RowDataPacket[]>('SELECT status FROM tabelas_tarifa WHERE id = ?', [
          id,
        ]);
        if (tab?.status === 'RASCUNHO' && origem === 'DETECCAO') await apagarMarca();
        else
          await registrarEvento(c, {
            siteId,
            tipo: 'tarifa.arquivada',
            agregadoTipo: 'tabela_tarifa',
            agregadoId: id,
            payload: { tipo: 'tabela_tarifa_arquivada', tabelaId: id },
            origem,
          });
      }
    } else {
      await apagarMarca();
    }
  }

  /** Vagas livres: compara o estado atual com o último enviado (sem disputar linha a cada entrada). */
  private async vigiarDisponibilidade(siteId: string) {
    const atual = await projecaoDisponibilidade(pool, siteId);
    const [[ultimo]] = await pool.query<RowDataPacket[]>(
      `SELECT payload FROM sync_outbox WHERE site_id = ? AND tipo = 'vagas.disponibilidade' AND versao >= 2
        ORDER BY seq DESC LIMIT 1`,
      [siteId],
    );
    const enviado = ultimo
      ? (typeof ultimo.payload === 'string' ? JSON.parse(ultimo.payload) : ultimo.payload).disponibilidade
      : null;
    if (enviado && impressao('disponibilidade', enviado) === impressao('disponibilidade', atual)) return;
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      await publicarDisponibilidade(c, siteId, 'DETECCAO');
      await c.commit();
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
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
    const resposta = await this.chamar<RespostaPushSync>('/sync/v1/push', lote, eventos);
    if (resposta === 'CONFLITO') {
      // A nuvem ainda não conhece o estacionamento (ou perdeu os dados): carga completa primeiro
      await pool.query('UPDATE sync_estado SET snapshot_pendente = TRUE WHERE site_id = ?', [siteId]);
      this.ultimoContato = 0;
      return true;
    }
    const { corpo: r, requisicaoId } = resposta;
    const rejeitados = new Map(r.rejeitados.map((x) => [x.eventId, x.motivo]));
    const resultados = new Map((r.resultados ?? []).map((x) => [x.eventId, x.resultado]));
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      for (const e of eventos) {
        const motivo = rejeitados.get(e.eventId);
        const resultado = motivo ? 'REJEITADO' : (resultados.get(e.eventId) ?? 'APLICADO');
        // Só muda o que ainda está pendente: confirmar duas vezes não altera nada
        await c.query(
          `UPDATE sync_outbox SET status = ?, resultado_nuvem = ?, enviado_em = NOW(3), tentativas = tentativas + 1,
             ultimo_erro = ? WHERE event_id = ? AND status = 'PENDENTE'`,
          [
            motivo ? 'REJEITADO' : 'ENVIADO',
            resultado,
            motivo ? `Recusado pela nuvem: ${motivo}`.slice(0, 1000) : null,
            e.eventId,
          ],
        );
      }
      await c.query(
        `UPDATE sync_estado SET ultimo_seq_confirmado = GREATEST(ultimo_seq_confirmado, ?), ultimo_push_em = NOW(3),
           ultimo_sucesso_em = NOW(3), ultimo_contato_em = NOW(3), falhas_seguidas = 0, ultimo_erro = NULL
          WHERE site_id = ?`,
        [eventos.reduce((m, e) => Math.max(m, e.seq), 0), siteId],
      );
      if (eventos.length)
        await execucao(c, siteId, {
          tipo: 'PUSH',
          inicio,
          sucesso: true,
          eventos,
          status: 200,
          requisicaoId,
          detalhes: {
            aplicados: r.aplicados,
            repetidos: r.repetidos,
            superados: r.superados,
            rejeitados: r.rejeitados.length,
          },
        });
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

    let requisicaoId: string | null = null;
    for (const p of partes) {
      const r = await this.chamar<RespostaSnapshotSync>('/sync/v1/snapshot', p, []);
      if (r === 'CONFLITO')
        throw new ErroSync('A nuvem recusou a carga completa (recomeçando).', 'SERVIDOR', 409);
      requisicaoId = r.requisicaoId;
    }
    const tickets = partes.reduce((n, p) => n + (p.tickets?.length ?? 0), 0);
    const t = await pool.getConnection();
    try {
      await t.beginTransaction();
      // Eventos até a fotografia já estão cobertos pela carga completa
      await t.query(
        `UPDATE sync_outbox SET status = 'ENVIADO', resultado_nuvem = 'SUPERADO', enviado_em = NOW(3),
           ultimo_erro = 'Coberto pela carga completa'
          WHERE site_id = ? AND status = 'PENDENTE' AND seq <= ?`,
        [siteId, seq],
      );
      await t.query(
        `UPDATE sync_estado SET snapshot_pendente = FALSE, ultimo_snapshot_em = NOW(3), ultimo_sucesso_em = NOW(3),
           ultimo_contato_em = NOW(3), ultimo_seq_confirmado = GREATEST(ultimo_seq_confirmado, ?), falhas_seguidas = 0,
           ultimo_erro = NULL, conferencia_pendente = TRUE WHERE site_id = ?`,
        [seq, siteId],
      );
      await execucao(t, siteId, {
        tipo: 'SNAPSHOT',
        inicio,
        sucesso: true,
        itens: tickets,
        status: 200,
        requisicaoId,
        detalhes: { partes: partes.length, tickets, tabelas: partes[0]?.tabelas?.length ?? 0, seq },
      });
      await t.commit();
    } catch (e) {
      await t.rollback().catch(() => undefined);
      throw e;
    } finally {
      t.release();
    }
    this.ultimoContato = Date.now();
    logger.info({ tickets, partes: partes.length }, 'Sincronização: carga completa enviada à nuvem');
  }

  /**
   * CONFERÊNCIA entre os bancos: manda a impressão digital do estado atual de
   * cada item visível; corrige o que a nuvem tiver diferente, faltando ou
   * sobrando. Só roda com a fila vazia (senão a diferença é só atraso).
   */
  private async conferir(siteId: string) {
    const inicio = Date.now();
    const itens: PedidoConferenciaSync['itens'] = [];
    const c = await pool.getConnection();
    try {
      await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const [[fila]] = await c.query<RowDataPacket[]>(
        `SELECT (SELECT COUNT(*) FROM sync_outbox WHERE site_id = ? AND status = 'PENDENTE') +
                (SELECT COUNT(*) FROM sync_marcas WHERE site_id = ?) AS n`,
        [siteId, siteId],
      );
      if (Number(fila?.n)) {
        await c.commit();
        return; // ainda há o que enviar: confere no próximo ciclo
      }
      itens.push({ tipo: 'site', id: siteId, hash: impressao('site', await projecaoSite(c, siteId)) });
      itens.push({
        tipo: 'disponibilidade',
        id: siteId,
        hash: impressao('disponibilidade', await projecaoDisponibilidade(c, siteId)),
      });
      for (const id of await tabelasPublicadasVisiveis(c, siteId))
        itens.push({
          tipo: 'tabela_tarifa',
          id,
          hash: impressao('tabela_tarifa', await projecaoTabelaTarifa(c, id)),
        });
      for (const id of await ticketsVisiveis(c, siteId))
        itens.push({ tipo: 'ticket', id, hash: impressao('ticket', await projecaoTicket(c, id)) });
      await c.commit();
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }

    const resposta = await this.chamar<RespostaConferenciaSync>('/sync/v1/conferir', { siteId, itens }, []);
    if (resposta === 'CONFLITO') {
      await pool.query('UPDATE sync_estado SET snapshot_pendente = TRUE WHERE site_id = ?', [siteId]);
      return;
    }
    const { corpo: r, requisicaoId } = resposta;
    const corrigir = [...r.divergentes, ...r.sobrando];
    const t = await pool.getConnection();
    try {
      await t.beginTransaction();
      for (const d of corrigir) await this.publicarAtual(t, siteId, d.tipo, d.id, 'CONFERENCIA');
      await t.query(
        `UPDATE sync_estado SET ultima_conferencia_em = NOW(3), ultima_conferencia_divergencias = ?,
           conferencia_pendente = FALSE, ultimo_contato_em = NOW(3), falhas_seguidas = 0, ultimo_erro = NULL
          WHERE site_id = ?`,
        [corrigir.length, siteId],
      );
      await execucao(t, siteId, {
        tipo: 'CONFERENCIA',
        inicio,
        sucesso: true,
        itens: itens.length,
        status: 200,
        requisicaoId,
        detalhes: {
          conferidos: r.conferidos,
          divergentes: r.divergentes.slice(0, 50),
          sobrando: r.sobrando.slice(0, 50),
        },
      });
      await t.commit();
    } catch (e) {
      await t.rollback().catch(() => undefined);
      throw e;
    } finally {
      t.release();
    }
    this.ultimaConferencia = Date.now();
    this.ultimoContato = Date.now();
    (corrigir.length ? logger.warn.bind(logger) : logger.debug.bind(logger))(
      { conferidos: itens.length, divergentes: r.divergentes.length, sobrando: r.sobrando.length },
      corrigir.length
        ? 'Sincronização: diferenças com a nuvem encontradas e corrigidas'
        : 'Sincronização: nuvem conferida, tudo igual',
    );
  }

  private async chamar<T>(
    rota: string,
    corpo: unknown,
    eventos: EventoSync[],
  ): Promise<{ corpo: T; requisicaoId: string | null } | 'CONFLITO'> {
    let r;
    try {
      r = await chamarNuvem<T>(this.cred, 'POST', rota, corpo);
    } catch (e) {
      if (e instanceof FalhaDeRede) throw new ErroSync(e.message, 'REDE');
      throw e;
    }
    if (r.status >= 200 && r.status < 300 && r.corpo) return { corpo: r.corpo, requisicaoId: r.requisicaoId };
    if (r.status === 409) return 'CONFLITO';
    if (r.status === 401 || r.status === 403)
      throw new ErroSync(
        `A nuvem recusou a credencial (${r.erro}). Confira SYNC_INTEGRACAO_ID e SYNC_SECRET.`,
        'CREDENCIAL',
        r.status,
        r.requisicaoId,
      );
    if (r.status === 400 || r.status === 413) {
      // Formato recusado: conta tentativas; depois de algumas, os eventos vão para a dead-letter
      if (eventos.length) {
        await pool.query(
          `UPDATE sync_outbox SET tentativas = tentativas + 1, ultimo_erro = ?,
             status = IF(tentativas >= ?, 'REJEITADO', status), enviado_em = IF(tentativas >= ?, NOW(3), enviado_em),
             resultado_nuvem = IF(tentativas >= ?, 'REJEITADO', resultado_nuvem)
            WHERE event_id IN (?) AND status = 'PENDENTE'`,
          [
            `Lote recusado: ${r.erro}`.slice(0, 1000),
            MAX_TENTATIVAS_INVALIDO,
            MAX_TENTATIVAS_INVALIDO,
            MAX_TENTATIVAS_INVALIDO,
            eventos.map((e) => e.eventId),
          ],
        );
      }
      throw new ErroSync(
        `A nuvem recusou os dados enviados: ${r.erro}`,
        'INVALIDO',
        r.status,
        r.requisicaoId,
      );
    }
    throw new ErroSync(`API externa indisponível: ${r.erro}`, 'SERVIDOR', r.status, r.requisicaoId);
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
      // Tentativa registrada nos eventos que esperam (controle de tentativas por evento)
      if (this.etapa === 'PUSH')
        await pool.query(
          `UPDATE sync_outbox SET tentativas = tentativas + 1, ultimo_erro = ?, proxima_tentativa_em = ?
            WHERE site_id = ? AND status = 'PENDENTE' ORDER BY seq LIMIT ?`,
          [e.message.slice(0, 1000), new Date(this.esperarAte), siteId, MAX_EVENTOS],
        );
      await pool.query(
        `UPDATE sync_estado SET falhas_seguidas = ?, ultimo_erro = ?, ultimo_erro_em = NOW(3) WHERE site_id = ?`,
        [falhas, e.message.slice(0, 1000), siteId],
      );
      await execucao(pool, siteId, {
        tipo: this.etapa,
        inicio: this.inicioEtapa,
        sucesso: false,
        status: e.status,
        erro: e.message,
        requisicaoId: e.requisicaoId,
        detalhes: {
          tipoFalha: e.tipo,
          falhasSeguidas: falhas,
          proximaTentativaEmS: Math.round(espera / 1000),
        },
      });
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

/** Status de cada sincronização (sync_execucoes): o que foi, quando, quanto tempo, com que resultado. */
async function execucao(
  c: PoolConnection | typeof pool,
  siteId: string,
  e: {
    tipo: Etapa;
    inicio: number;
    sucesso: boolean;
    eventos?: EventoSync[];
    itens?: number;
    status: number | null;
    erro?: string | null;
    requisicaoId?: string | null;
    detalhes?: Record<string, unknown>;
  },
) {
  const eventos = e.eventos ?? [];
  await c.query(
    `INSERT INTO sync_execucoes (site_id, tipo, iniciado_em, finalizado_em, sucesso, itens, primeiro_seq, ultimo_seq,
       http_status, duracao_ms, erro, requisicao_id, detalhes)
     VALUES (?, ?, ?, NOW(3), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      siteId,
      e.tipo,
      new Date(e.inicio),
      e.sucesso,
      e.itens ?? eventos.length,
      eventos[0]?.seq ?? null,
      eventos.at(-1)?.seq ?? null,
      e.status,
      Date.now() - e.inicio,
      e.erro?.slice(0, 1000) ?? null,
      e.requisicaoId && /^[0-9a-f-]{36}$/.test(e.requisicaoId) ? e.requisicaoId : null,
      e.detalhes ? JSON.stringify(e.detalhes) : null,
    ],
  );
}
