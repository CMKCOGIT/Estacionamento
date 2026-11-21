import { ulid } from 'ulid';
import { VERSAO_EVENTOS_SYNC, type DadosEventoSync } from '@estacionamento/shared';
import type { Conexao } from '../db/pool.js';
import { projecaoDisponibilidade, projecaoSite, projecaoTabelaTarifa, projecaoTicket } from './projecoes.js';

/**
 * Grava um evento na fila de sincronização (sync_outbox) DENTRO da transação
 * da alteração de negócio: ou os dois ficam gravados, ou nenhum. O worker
 * (sync/worker.ts) envia os eventos para a API externa.
 *
 * O `payload` é a projeção pública do que mudou (DadosEventoSync): o estado
 * atual, já no formato que a nuvem guarda. Assim um evento repetido ou fora
 * de ordem nunca deixa a nuvem num estado inconsistente.
 */
export async function registrarEvento(
  c: Conexao,
  e: {
    siteId: string;
    tipo: string;
    agregadoTipo: string;
    agregadoId: string;
    payload: DadosEventoSync;
    /** Quem gerou: o serviço (padrão), a detecção pelo banco ou a conferência com a nuvem. */
    origem?: 'APLICACAO' | 'DETECCAO' | 'CONFERENCIA';
  },
): Promise<string> {
  const eventId = ulid(); // identificador único do evento: base da idempotência na nuvem
  await c.query(
    `INSERT INTO sync_outbox (event_id, site_id, tipo, versao, origem, agregado_tipo, agregado_id, payload, ocorrido_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
    [
      eventId,
      e.siteId,
      e.tipo,
      VERSAO_EVENTOS_SYNC,
      e.origem ?? 'APLICACAO',
      e.agregadoTipo,
      e.agregadoId,
      JSON.stringify(e.payload),
    ],
  );
  // O evento cobre a alteração: a marca da detecção pelo banco (012) não precisa mais gerar outro
  const marca = marcaDoEvento(e.siteId, e.payload);
  await c.query('DELETE FROM sync_marcas WHERE tipo = ? AND agregado_id = ?', marca);
  return eventId;
}

function marcaDoEvento(siteId: string, d: DadosEventoSync): [string, string] {
  switch (d.tipo) {
    case 'ticket':
      return ['ticket', d.ticket.id];
    case 'ticket_removido':
      return ['ticket', d.ticketId];
    case 'tabela_tarifa':
      return ['tabela_tarifa', d.tabela.tabelaId];
    case 'tabela_tarifa_arquivada':
      return ['tabela_tarifa', d.tabelaId];
    case 'disponibilidade':
      return ['disponibilidade', siteId];
    case 'site':
      return ['site', siteId];
  }
}

/** Evento do ticket (aberto, pagamento, fechado, cancelado, novo link...) com o estado público atual. */
export async function publicarTicket(
  c: Conexao,
  siteId: string,
  tipo: string,
  sessaoId: string,
  origem?: 'APLICACAO' | 'DETECCAO' | 'CONFERENCIA',
): Promise<void> {
  await registrarEvento(c, {
    siteId,
    origem,
    tipo,
    agregadoTipo: 'ticket',
    agregadoId: sessaoId,
    payload: { tipo: 'ticket', ticket: await projecaoTicket(c, sessaoId) },
  });
}

/** Evento `vagas.disponibilidade`: totais por categoria, para o PWA dos clientes. */
export async function publicarDisponibilidade(
  c: Conexao,
  siteId: string,
  origem?: 'APLICACAO' | 'DETECCAO' | 'CONFERENCIA',
): Promise<void> {
  await registrarEvento(c, {
    siteId,
    origem,
    tipo: 'vagas.disponibilidade',
    agregadoTipo: 'site',
    agregadoId: siteId,
    payload: { tipo: 'disponibilidade', disponibilidade: await projecaoDisponibilidade(c, siteId) },
  });
}

/** Tabela de tarifas publicada (preços mostrados ao cliente). */
export async function publicarTabelaTarifa(
  c: Conexao,
  siteId: string,
  tabelaId: string,
  origem?: 'APLICACAO' | 'DETECCAO' | 'CONFERENCIA',
): Promise<void> {
  await registrarEvento(c, {
    siteId,
    origem,
    tipo: 'tarifa.publicada',
    agregadoTipo: 'tabela_tarifa',
    agregadoId: tabelaId,
    payload: { tipo: 'tabela_tarifa', tabela: await projecaoTabelaTarifa(c, tabelaId) },
  });
}

/** Dados do estacionamento e política do link do cliente. */
export async function publicarSite(
  c: Conexao,
  siteId: string,
  origem?: 'APLICACAO' | 'DETECCAO' | 'CONFERENCIA',
): Promise<void> {
  await registrarEvento(c, {
    siteId,
    origem,
    tipo: 'site.atualizado',
    agregadoTipo: 'site',
    agregadoId: siteId,
    payload: { tipo: 'site', site: await projecaoSite(c, siteId) },
  });
}
