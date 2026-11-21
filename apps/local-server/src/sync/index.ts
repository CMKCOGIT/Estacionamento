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
  };
}

/** "Ressincronizar" no painel: reenvia o estado completo (implantação, troca de provedor, recuperação). */
export async function pedirRessincronizacao(): Promise<void> {
  const site = await obterSiteAtual();
  await pool.query('INSERT IGNORE INTO sync_estado (site_id) VALUES (?)', [site.id]);
  await pool.query('UPDATE sync_estado SET snapshot_pendente = TRUE WHERE site_id = ?', [site.id]);
  trabalhador?.acordar();
}
