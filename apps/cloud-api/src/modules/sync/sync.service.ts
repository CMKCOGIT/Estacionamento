import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { z } from 'zod';
import type { RespostaPushSync, RespostaSnapshotSync, StatusSync } from '@estacionamento/shared';
import { pool } from '../../db/pool.js';
import { ErroApiPublica } from '../../http/erros.js';
import type { Integracao } from '../../integracoes/credenciais.js';
import { integracoesRepository } from '../../integracoes/credenciais.js';
import type { schemaDisponibilidade, schemaSite, schemaTabela, schemaTicket } from './sync.schemas.js';
import { schemaDados, schemaLote, schemaParteSnapshot } from './sync.schemas.js';

type Site = z.infer<typeof schemaSite>;
type Disponibilidade = z.infer<typeof schemaDisponibilidade>;
type Tabela = z.infer<typeof schemaTabela>;
type Ticket = z.infer<typeof schemaTicket>;
type Resultado = 'APLICADO' | 'SUPERADO';

/** Uma regra de negócio impede aplicar este evento (vira rejeição individual, não erro do lote). */
class Rejeicao extends Error {}

const data = (iso: string | null) => (iso ? new Date(iso) : null);

/**
 * Aplicação no modelo de leitura. Cada item guarda o `seq` do último evento
 * aplicado: um evento mais antigo que isso é "superado" (não desfaz o novo).
 * Na carga completa (snapshot) o mesmo seq também é aplicado (`>=`).
 */
const aplicar = {
  async site(c: PoolConnection, siteId: string, s: Site, seq: number, snapshot = false): Promise<Resultado> {
    const [[atual]] = await c.query<RowDataPacket[]>(
      'SELECT seq_aplicado FROM sites_publicos WHERE id = ? FOR UPDATE',
      [siteId],
    );
    if (atual && !novo(Number(atual.seq_aplicado), seq, snapshot)) return 'SUPERADO';
    const [[outro]] = await c.query<RowDataPacket[]>(
      'SELECT id FROM sites_publicos WHERE slug = ? AND id <> ?',
      [s.slug, siteId],
    );
    if (outro) throw new Rejeicao(`o endereço (slug) "${s.slug}" já é de outro estacionamento`);
    await c.query(
      `INSERT INTO sites_publicos (id, slug, nome, endereco, telefone, horas_acesso_apos_saida, sincronizado_em, seq_aplicado)
       VALUES (?, ?, ?, ?, ?, ?, NOW(3), ?)
       ON DUPLICATE KEY UPDATE slug = VALUES(slug), nome = VALUES(nome), endereco = VALUES(endereco), telefone = VALUES(telefone),
         horas_acesso_apos_saida = VALUES(horas_acesso_apos_saida), sincronizado_em = NOW(3), seq_aplicado = VALUES(seq_aplicado)`,
      [siteId, s.slug, s.nome, s.endereco, s.telefone, s.horasAcessoAposSaida, seq],
    );
    return 'APLICADO';
  },

  async disponibilidade(
    c: PoolConnection,
    siteId: string,
    d: Disponibilidade,
    seq: number,
    ocorridoEm: Date,
    snapshot = false,
  ): Promise<Resultado> {
    const [[atual]] = await c.query<RowDataPacket[]>(
      'SELECT MAX(seq_aplicado) AS seq FROM disponibilidade_publica WHERE site_id = ? FOR UPDATE',
      [siteId],
    );
    if (atual?.seq !== null && atual?.seq !== undefined && !novo(Number(atual.seq), seq, snapshot))
      return 'SUPERADO';
    await c.query('DELETE FROM disponibilidade_publica WHERE site_id = ?', [siteId]);
    if (d.categorias.length) {
      await c.query(
        'INSERT INTO disponibilidade_publica (site_id, categoria_id, categoria, ordem, total, livres, atualizado_em, seq_aplicado) VALUES ?',
        [d.categorias.map((k) => [siteId, k.id, k.nome, k.ordem, k.total, k.livres, ocorridoEm, seq])],
      );
    }
    return 'APLICADO';
  },

  async tabela(
    c: PoolConnection,
    siteId: string,
    t: Tabela,
    seq: number,
    snapshot = false,
  ): Promise<Resultado> {
    const [[atual]] = await c.query<RowDataPacket[]>(
      'SELECT MAX(seq_aplicado) AS seq FROM tarifas_publicas WHERE site_id = ? AND tabela_id = ? FOR UPDATE',
      [siteId, t.tabelaId],
    );
    if (atual?.seq !== null && atual?.seq !== undefined && !novo(Number(atual.seq), seq, snapshot))
      return 'SUPERADO';
    await c.query('DELETE FROM tarifas_publicas WHERE site_id = ? AND (tabela_id = ? OR tabela_id IS NULL)', [
      siteId,
      t.tabelaId,
    ]);
    const [[dono]] = await c.query<RowDataPacket[]>(
      'SELECT site_id FROM tarifas_publicas WHERE id IN (?) AND site_id <> ? LIMIT 1',
      [t.tarifas.map((x) => x.id).concat(['-']), siteId],
    );
    if (dono) throw new Rejeicao('regra de tarifa pertence a outro estacionamento');
    if (t.tarifas.length) {
      await c.query(
        `INSERT INTO tarifas_publicas (id, site_id, tabela_id, tabela_versao, categoria, ordem, nome, especial, condicao, linhas, vigente_desde, seq_aplicado)
         VALUES ? ON DUPLICATE KEY UPDATE tabela_id = VALUES(tabela_id), tabela_versao = VALUES(tabela_versao), categoria = VALUES(categoria),
           ordem = VALUES(ordem), nome = VALUES(nome), especial = VALUES(especial), condicao = VALUES(condicao), linhas = VALUES(linhas),
           vigente_desde = VALUES(vigente_desde), seq_aplicado = VALUES(seq_aplicado)`,
        [
          t.tarifas.map((x) => [
            x.id,
            siteId,
            t.tabelaId,
            t.versao,
            x.categoria,
            x.ordem,
            x.nome,
            x.especial,
            x.condicao,
            JSON.stringify(x.linhas),
            new Date(t.vigenteDesde),
            seq,
          ]),
        ],
      );
    }
    return 'APLICADO';
  },

  async tabelaArquivada(
    c: PoolConnection,
    siteId: string,
    tabelaId: string,
    seq: number,
  ): Promise<Resultado> {
    const [r] = await c.query<ResultSetHeader>(
      'DELETE FROM tarifas_publicas WHERE site_id = ? AND tabela_id = ? AND seq_aplicado < ?',
      [siteId, tabelaId, seq],
    );
    return r.affectedRows > 0 ? 'APLICADO' : 'SUPERADO';
  },

  async ticket(
    c: PoolConnection,
    siteId: string,
    t: Ticket,
    seq: number,
    snapshotId: string | null = null,
  ): Promise<Resultado> {
    const [[atual]] = await c.query<RowDataPacket[]>(
      'SELECT site_id, seq_aplicado FROM tickets_publicos WHERE id = ? FOR UPDATE',
      [t.id],
    );
    if (atual && atual.site_id !== siteId) throw new Rejeicao('ticket pertence a outro estacionamento');
    if (atual && !novo(Number(atual.seq_aplicado), seq, snapshotId !== null)) {
      if (snapshotId)
        await c.query('UPDATE tickets_publicos SET snapshot_id = ? WHERE id = ?', [snapshotId, t.id]);
      return 'SUPERADO';
    }
    await c.query(
      `INSERT INTO tickets_publicos (id, site_id, numero, placa, categoria, vaga, modalidade, situacao, entrada_em, saida_em, regra,
         tarifa_descricao, tarifa_nome, valor_final_centavos, itens_final, pago_centavos, acesso_expira_em, sincronizado_em, seq_aplicado, snapshot_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?, ?)
       ON DUPLICATE KEY UPDATE numero = VALUES(numero), placa = VALUES(placa), categoria = VALUES(categoria), vaga = VALUES(vaga),
         modalidade = VALUES(modalidade), situacao = VALUES(situacao), entrada_em = VALUES(entrada_em), saida_em = VALUES(saida_em),
         regra = VALUES(regra), tarifa_descricao = VALUES(tarifa_descricao), tarifa_nome = VALUES(tarifa_nome),
         valor_final_centavos = VALUES(valor_final_centavos), itens_final = VALUES(itens_final), pago_centavos = VALUES(pago_centavos),
         acesso_expira_em = VALUES(acesso_expira_em), sincronizado_em = NOW(3), seq_aplicado = VALUES(seq_aplicado),
         snapshot_id = COALESCE(VALUES(snapshot_id), snapshot_id)`,
      [
        t.id,
        siteId,
        t.numero,
        t.placa,
        t.categoria,
        t.vaga,
        t.modalidade,
        t.situacao,
        new Date(t.entradaEm),
        data(t.saidaEm),
        JSON.stringify(t.regra),
        t.tarifaDescricao,
        t.tarifaNome,
        t.valorFinalCentavos,
        t.itensFinal ? JSON.stringify(t.itensFinal) : null,
        t.pagoCentavos,
        data(t.acessoExpiraEm),
        seq,
        snapshotId,
      ],
    );
    for (const k of t.tokens) {
      const hash = Buffer.from(k.hash, 'hex');
      const [[dono]] = await c.query<RowDataPacket[]>(
        'SELECT ticket_id FROM tickets_tokens WHERE token_hash = ?',
        [hash],
      );
      if (dono && dono.ticket_id !== t.id) throw new Rejeicao('token já pertence a outro ticket');
      await c.query(
        'INSERT INTO tickets_tokens (token_hash, ticket_id, revogado_em) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE revogado_em = VALUES(revogado_em)',
        [hash, t.id, data(k.revogadoEm)],
      );
    }
    // Token que não veio mais na projeção: revogado (o local é a fonte da verdade)
    const hashes = t.tokens.map((k) => Buffer.from(k.hash, 'hex'));
    await c.query(
      `UPDATE tickets_tokens SET revogado_em = COALESCE(revogado_em, NOW(3))
        WHERE ticket_id = ? ${hashes.length ? 'AND token_hash NOT IN (?)' : ''}`,
      hashes.length ? [t.id, hashes] : [t.id],
    );
    return 'APLICADO';
  },
};

function novo(aplicado: number, seq: number, snapshot: boolean) {
  return snapshot ? seq >= aplicado : seq > aplicado;
}

async function transacao<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const r = await fn(c);
    await c.commit();
    return r;
  } catch (e) {
    await c.rollback().catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** A credencial só escreve no próprio estacionamento (a primeira vez, fica presa a ele). */
async function siteDaIntegracao(integracao: Integracao, siteId: string): Promise<{ vinculou: boolean }> {
  if (integracao.siteId === siteId) return { vinculou: false };
  if (integracao.siteId === null && (await integracoesRepository.vincularSite(integracao.id, siteId))) {
    integracao.siteId = siteId;
    return { vinculou: true };
  }
  throw new ErroApiPublica(403, 'PROIBIDO', 'Esta credencial não pertence a este estacionamento.');
}

async function tocarEstado(c: PoolConnection, siteId: string, seq: number) {
  await c.query(
    `INSERT INTO sync_estado (site_id, ultimo_seq, ultimo_contato_em) VALUES (?, ?, NOW(3))
     ON DUPLICATE KEY UPDATE ultimo_seq = GREATEST(ultimo_seq, VALUES(ultimo_seq)), ultimo_contato_em = NOW(3)`,
    [siteId, seq],
  );
  // Sinal de vida: o PWA usa isto para avisar quando o estacionamento para de enviar dados
  await c.query('UPDATE sites_publicos SET sincronizado_em = NOW(3) WHERE id = ?', [siteId]);
}

export const syncService = {
  async push(
    integracao: Integracao,
    corpo: unknown,
    aoVincular?: () => Promise<void>,
  ): Promise<RespostaPushSync> {
    const lote = schemaLote.parse(corpo);
    if ((await siteDaIntegracao(integracao, lote.siteId)).vinculou) await aoVincular?.();
    const eventos = [...lote.eventos].sort((a, b) => a.seq - b.seq);

    return transacao(async (c) => {
      const [[site]] = await c.query<RowDataPacket[]>('SELECT id FROM sites_publicos WHERE id = ?', [
        lote.siteId,
      ]);
      const primeiroEhSite = eventos.some((e) => (e.dados as { tipo?: string })?.tipo === 'site');
      if (!site && eventos.length && !primeiroEhSite)
        throw new ErroApiPublica(
          409,
          'CONFLITO',
          'Estacionamento ainda não sincronizado: envie a carga completa (/sync/v1/snapshot).',
        );

      const r: RespostaPushSync = {
        aplicados: 0,
        repetidos: 0,
        superados: 0,
        rejeitados: [],
        ultimoSeq: 0,
        recebidoEm: new Date().toISOString(),
      };
      for (const e of eventos) {
        const [[ja]] = await c.query<RowDataPacket[]>(
          'SELECT resultado FROM sync_aplicados WHERE event_id = ?',
          [e.eventId],
        );
        if (ja) {
          r.repetidos++;
          continue;
        }
        let resultado: Resultado | 'REJEITADO';
        const dados = schemaDados.safeParse(e.dados);
        if (!dados.success) {
          resultado = 'REJEITADO';
          r.rejeitados.push({
            eventId: e.eventId,
            motivo: dados.error.issues
              .slice(0, 3)
              .map((i) => `${i.path.join('.') || 'dados'}: ${i.message}`)
              .join('; '),
          });
        } else {
          await c.query('SAVEPOINT evento');
          try {
            const d = dados.data;
            resultado =
              d.tipo === 'site'
                ? await aplicar.site(c, lote.siteId, d.site, e.seq)
                : d.tipo === 'disponibilidade'
                  ? await aplicar.disponibilidade(
                      c,
                      lote.siteId,
                      d.disponibilidade,
                      e.seq,
                      new Date(e.ocorridoEm),
                    )
                  : d.tipo === 'tabela_tarifa'
                    ? await aplicar.tabela(c, lote.siteId, d.tabela, e.seq)
                    : d.tipo === 'tabela_tarifa_arquivada'
                      ? await aplicar.tabelaArquivada(c, lote.siteId, d.tabelaId, e.seq)
                      : await aplicar.ticket(c, lote.siteId, d.ticket, e.seq);
            await c.query('RELEASE SAVEPOINT evento');
          } catch (erro) {
            if (!(erro instanceof Rejeicao)) throw erro;
            await c.query('ROLLBACK TO SAVEPOINT evento');
            resultado = 'REJEITADO';
            r.rejeitados.push({ eventId: e.eventId, motivo: erro.message });
          }
        }
        if (resultado === 'APLICADO') r.aplicados++;
        else if (resultado === 'SUPERADO') r.superados++;
        await c.query(
          'INSERT INTO sync_aplicados (event_id, site_id, seq, tipo, resultado) VALUES (?, ?, ?, ?, ?)',
          [e.eventId, lote.siteId, e.seq, e.tipo, resultado],
        );
      }
      const maior = eventos.reduce((m, e) => Math.max(m, e.seq), 0);
      if (site || eventos.length) await tocarEstado(c, lote.siteId, maior);
      const [[estado]] = await c.query<RowDataPacket[]>(
        'SELECT ultimo_seq FROM sync_estado WHERE site_id = ?',
        [lote.siteId],
      );
      r.ultimoSeq = Number(estado?.ultimo_seq ?? 0);
      return r;
    });
  },

  async snapshot(
    integracao: Integracao,
    corpo: unknown,
    aoVincular?: () => Promise<void>,
  ): Promise<RespostaSnapshotSync & { tickets: number }> {
    const p = schemaParteSnapshot.parse(corpo);
    if (p.parte > p.totalPartes)
      throw new ErroApiPublica(400, 'REQUISICAO_INVALIDA', 'Parte maior que o total.');
    if ((await siteDaIntegracao(integracao, p.siteId)).vinculou) await aoVincular?.();

    return transacao(async (c) => {
      const [[estado]] = await c.query<RowDataPacket[]>(
        'SELECT snapshot_id FROM sync_estado WHERE site_id = ? FOR UPDATE',
        [p.siteId],
      );
      if (p.parte === 1) {
        await c.query(
          `INSERT INTO sync_estado (site_id, snapshot_id) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE snapshot_id = VALUES(snapshot_id)`,
          [p.siteId, p.snapshotId],
        );
      } else if (estado?.snapshot_id !== p.snapshotId) {
        throw new ErroApiPublica(
          409,
          'CONFLITO',
          'Carga completa desconhecida ou substituída: recomece pela parte 1.',
        );
      }
      const [[site]] = await c.query<RowDataPacket[]>('SELECT id FROM sites_publicos WHERE id = ?', [
        p.siteId,
      ]);
      if (!site && !p.site)
        throw new ErroApiPublica(
          400,
          'REQUISICAO_INVALIDA',
          'A parte 1 da carga completa precisa trazer o estacionamento.',
        );

      try {
        if (p.site) await aplicar.site(c, p.siteId, p.site, p.seq, true);
        if (p.disponibilidade)
          await aplicar.disponibilidade(c, p.siteId, p.disponibilidade, p.seq, new Date(), true);
        for (const t of p.tabelas ?? []) await aplicar.tabela(c, p.siteId, t, p.seq, true);
        for (const t of p.tickets ?? []) await aplicar.ticket(c, p.siteId, t, p.seq, p.snapshotId);
      } catch (erro) {
        if (erro instanceof Rejeicao) throw new ErroApiPublica(400, 'REQUISICAO_INVALIDA', erro.message);
        throw erro;
      }

      let removidos = 0;
      const concluido = p.parte === p.totalPartes;
      if (concluido) {
        // O que estava na nuvem e não veio na carga (e não mudou depois dela) sai
        const tabelas = (p.tabelas ?? []).map((t) => t.tabelaId);
        if (tabelas.length) {
          await c.query(
            'DELETE FROM tarifas_publicas WHERE site_id = ? AND seq_aplicado <= ? AND (tabela_id IS NULL OR tabela_id NOT IN (?))',
            [p.siteId, p.seq, tabelas],
          );
        } else {
          await c.query('DELETE FROM tarifas_publicas WHERE site_id = ? AND seq_aplicado <= ?', [
            p.siteId,
            p.seq,
          ]);
        }
        await c.query(
          `DELETE k FROM tickets_tokens k JOIN tickets_publicos t ON t.id = k.ticket_id
            WHERE t.site_id = ? AND t.seq_aplicado <= ? AND (t.snapshot_id IS NULL OR t.snapshot_id <> ?)`,
          [p.siteId, p.seq, p.snapshotId],
        );
        const [r] = await c.query<ResultSetHeader>(
          `DELETE FROM tickets_publicos
            WHERE site_id = ? AND seq_aplicado <= ? AND (snapshot_id IS NULL OR snapshot_id <> ?)`,
          [p.siteId, p.seq, p.snapshotId],
        );
        removidos = r.affectedRows;
        await c.query(
          'UPDATE sync_estado SET snapshot_id = NULL, ultimo_snapshot_em = NOW(3) WHERE site_id = ?',
          [p.siteId],
        );
      }
      await tocarEstado(c, p.siteId, p.seq);
      return {
        snapshotId: p.snapshotId,
        parte: p.parte,
        concluido,
        removidos,
        tickets: p.tickets?.length ?? 0,
      };
    });
  },

  async status(integracao: Integracao): Promise<StatusSync> {
    if (!integracao.siteId)
      return { siteId: null, ultimoSeq: 0, ultimoContatoEm: null, ultimoSnapshotEm: null };
    const [[e]] = await pool.query<RowDataPacket[]>('SELECT * FROM sync_estado WHERE site_id = ?', [
      integracao.siteId,
    ]);
    return {
      siteId: integracao.siteId,
      ultimoSeq: Number(e?.ultimo_seq ?? 0),
      ultimoContatoEm: (e?.ultimo_contato_em as Date | undefined)?.toISOString() ?? null,
      ultimoSnapshotEm: (e?.ultimo_snapshot_em as Date | undefined)?.toISOString() ?? null,
    };
  },
};
