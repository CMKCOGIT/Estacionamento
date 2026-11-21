import type { RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { obterSiteAtual } from '../config/site.js';
import { pool } from '../db/pool.js';
import { TrabalhadorSync } from './worker.js';

/**
 * Sincronização com a API externa, ligada pelo .env:
 *   CLOUD_API_URL, SYNC_INTEGRACAO_ID e SYNC_SECRET (credencial criada na nuvem).
 * Roda dentro do servidor local, isolada: falha na nuvem nunca afeta a operação.
 */
let trabalhador: TrabalhadorSync | null = null;

export const syncConfigurado = () =>
  Boolean(env.SYNC_ATIVO && env.CLOUD_API_URL && env.SYNC_INTEGRACAO_ID && env.SYNC_SECRET);

export function iniciarSync(): void {
  if (!syncConfigurado()) {
    logger.info(
      'Sincronização com a nuvem desligada (configure CLOUD_API_URL, SYNC_INTEGRACAO_ID e SYNC_SECRET no .env).',
    );
    return;
  }
  trabalhador = new TrabalhadorSync({
    url: env.CLOUD_API_URL!,
    integracaoId: env.SYNC_INTEGRACAO_ID!,
    segredo: env.SYNC_SECRET!,
  });
  trabalhador.iniciar();
  logger.info({ nuvem: new URL(env.CLOUD_API_URL!).host }, 'Sincronização com a nuvem ligada');
}

export const pararSync = () => trabalhador?.parar();

export interface StatusSyncLocal {
  configurado: boolean;
  /** Só o endereço (host) da nuvem; nunca a credencial. */
  nuvem: string | null;
  situacao: 'DESLIGADA' | 'EM_DIA' | 'ENVIANDO' | 'COM_FALHA' | 'AGUARDANDO_PRIMEIRO_ENVIO';
  pendentes: number;
  pendenteMaisAntigoEm: string | null;
  rejeitados: { seq: number; tipo: string; erro: string | null; em: string | null }[];
  ultimoSucessoEm: string | null;
  ultimoContatoEm: string | null;
  ultimoSnapshotEm: string | null;
  snapshotPendente: boolean;
  falhasSeguidas: number;
  ultimoErro: string | null;
  ultimoErroEm: string | null;
  /** Alterações detectadas pelo banco que ainda vão virar evento. */
  marcasPendentes: number;
  ultimaConferenciaEm: string | null;
  ultimaConferenciaDivergencias: number | null;
  conferenciaPendente: boolean;
  /** Fila por origem e resultado na nuvem (últimos 30 dias). */
  resumo: { origem: string; resultado: string; total: number }[];
  /** Últimas sincronizações (status de cada uma). */
  historico: {
    id: number;
    tipo: string;
    iniciadoEm: string | null;
    sucesso: boolean;
    itens: number;
    duracaoMs: number | null;
    httpStatus: number | null;
    erro: string | null;
    requisicaoId: string | null;
    detalhes: Record<string, unknown> | null;
  }[];
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

export async function statusSync(): Promise<StatusSyncLocal> {
  const site = await obterSiteAtual();
  const [[e]] = await pool.query<RowDataPacket[]>('SELECT * FROM sync_estado WHERE site_id = ?', [site.id]);
  const [[p]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n, MIN(ocorrido_em) AS antigo FROM sync_outbox WHERE site_id = ? AND status = 'PENDENTE'",
    [site.id],
  );
  // Recusas depois da última carga completa (as anteriores já foram cobertas por ela)
  const [rej] = await pool.query<RowDataPacket[]>(
    `SELECT seq, tipo, ultimo_erro, enviado_em FROM sync_outbox
      WHERE site_id = ? AND status = 'REJEITADO' AND (? IS NULL OR enviado_em > ?)
      ORDER BY seq DESC LIMIT 20`,
    [site.id, e?.ultimo_snapshot_em ?? null, e?.ultimo_snapshot_em ?? null],
  );
  const [[marcas]] = await pool.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM sync_marcas WHERE site_id = ?',
    [site.id],
  );
  const [resumo] = await pool.query<RowDataPacket[]>(
    `SELECT origem, COALESCE(resultado_nuvem, status) AS resultado, COUNT(*) AS total FROM sync_outbox
      WHERE site_id = ? AND versao >= 2 AND criado_em >= NOW(3) - INTERVAL 30 DAY
      GROUP BY origem, COALESCE(resultado_nuvem, status) ORDER BY origem, resultado`,
    [site.id],
  );
  const [hist] = await pool.query<RowDataPacket[]>(
    `SELECT id, tipo, iniciado_em, sucesso, itens, duracao_ms, http_status, erro, requisicao_id, detalhes
       FROM sync_execucoes WHERE site_id = ? ORDER BY id DESC LIMIT 20`,
    [site.id],
  );
  const configurado = syncConfigurado();
  const pendentes = Number(p?.n ?? 0);
  const falhas = Number(e?.falhas_seguidas ?? 0);
  return {
    configurado,
    nuvem: env.CLOUD_API_URL ? new URL(env.CLOUD_API_URL).host : null,
    situacao: !configurado
      ? 'DESLIGADA'
      : falhas > 0
        ? 'COM_FALHA'
        : !e?.ultimo_sucesso_em
          ? 'AGUARDANDO_PRIMEIRO_ENVIO'
          : pendentes > 0
            ? 'ENVIANDO'
            : 'EM_DIA',
    pendentes,
    pendenteMaisAntigoEm: iso(p?.antigo),
    rejeitados: rej.map((r) => ({
      seq: Number(r.seq),
      tipo: String(r.tipo),
      erro: (r.ultimo_erro as string | null) ?? null,
      em: iso(r.enviado_em),
    })),
    ultimoSucessoEm: iso(e?.ultimo_sucesso_em),
    ultimoContatoEm: iso(e?.ultimo_contato_em),
    ultimoSnapshotEm: iso(e?.ultimo_snapshot_em),
    snapshotPendente: Boolean(Number(e?.snapshot_pendente ?? 1)),
    falhasSeguidas: falhas,
    ultimoErro: (e?.ultimo_erro as string | null) ?? null,
    ultimoErroEm: iso(e?.ultimo_erro_em),
    marcasPendentes: Number(marcas?.n ?? 0),
    ultimaConferenciaEm: iso(e?.ultima_conferencia_em),
    ultimaConferenciaDivergencias:
      e?.ultima_conferencia_divergencias === null || e?.ultima_conferencia_divergencias === undefined
        ? null
        : Number(e.ultima_conferencia_divergencias),
    conferenciaPendente: Boolean(Number(e?.conferencia_pendente ?? 0)),
    resumo: resumo.map((x) => ({
      origem: String(x.origem),
      resultado: String(x.resultado),
      total: Number(x.total),
    })),
    historico: hist.map((h) => ({
      id: Number(h.id),
      tipo: String(h.tipo),
      iniciadoEm: iso(h.iniciado_em),
      sucesso: Boolean(Number(h.sucesso)),
      itens: Number(h.itens),
      duracaoMs: h.duracao_ms === null ? null : Number(h.duracao_ms),
      httpStatus: h.http_status === null ? null : Number(h.http_status),
      erro: (h.erro as string | null) ?? null,
      requisicaoId: (h.requisicao_id as string | null) ?? null,
      detalhes: (typeof h.detalhes === 'string' ? JSON.parse(h.detalhes) : h.detalhes) ?? null,
    })),
  };
}

/** "Conferir agora" no painel: compara os bancos no próximo ciclo (com a fila vazia). */
export async function pedirConferencia(): Promise<void> {
  const site = await obterSiteAtual();
  await pool.query('INSERT IGNORE INTO sync_estado (site_id) VALUES (?)', [site.id]);
  await pool.query('UPDATE sync_estado SET conferencia_pendente = TRUE WHERE site_id = ?', [site.id]);
  trabalhador?.acordar();
}

/** "Ressincronizar" no painel: reenvia o estado completo (implantação, troca de provedor, recuperação). */
export async function pedirRessincronizacao(): Promise<void> {
  const site = await obterSiteAtual();
  await pool.query('INSERT IGNORE INTO sync_estado (site_id) VALUES (?)', [site.id]);
  await pool.query('UPDATE sync_estado SET snapshot_pendente = TRUE WHERE site_id = ?', [site.id]);
  trabalhador?.acordar();
}
