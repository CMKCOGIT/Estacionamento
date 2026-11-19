import type { RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import type { Conexao } from '../db/pool.js';

/**
 * Grava um evento na fila de sincronização (sync_outbox) DENTRO da transação
 * da alteração de negócio: ou os dois ficam gravados, ou nenhum.
 * O worker de sincronização (etapa futura) envia os eventos para a nuvem.
 */
export async function registrarEvento(
  c: Conexao,
  e: {
    siteId: string;
    tipo: string;
    agregadoTipo: string;
    agregadoId: string;
    payload: unknown;
    versao?: number;
  },
): Promise<string> {
  const eventId = ulid();
  await c.query(
    `INSERT INTO sync_outbox (event_id, site_id, tipo, versao, agregado_tipo, agregado_id, payload, ocorrido_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [eventId, e.siteId, e.tipo, e.versao ?? 1, e.agregadoTipo, e.agregadoId, JSON.stringify(e.payload)],
  );
  return eventId;
}

/** Evento `vagas.disponibilidade`: totais por categoria, para o PWA dos clientes. */
export async function publicarDisponibilidade(c: Conexao, siteId: string): Promise<void> {
  const [linhas] = await c.query<RowDataPacket[]>(
    `SELECT categoria_codigo, categoria_nome, capacidade_total, em_manutencao, ocupadas, livres
       FROM vw_ocupacao_categoria WHERE site_id = ?`,
    [siteId],
  );
  await registrarEvento(c, {
    siteId,
    tipo: 'vagas.disponibilidade',
    agregadoTipo: 'site',
    agregadoId: siteId,
    payload: {
      categorias: linhas.map((l) => ({
        codigo: l.categoria_codigo,
        nome: l.categoria_nome,
        total: Number(l.capacidade_total),
        bloqueadas: Number(l.em_manutencao),
        ocupadas: Number(l.ocupadas),
        livres: Math.max(0, Number(l.livres)),
      })),
    },
  });
}
