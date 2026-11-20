/**
 * Gravação de pagamentos — usada pela saída e pelo recebimento antecipado.
 *
 * Proteções contra pagamento duplicado por erro de operação:
 * 1. Chave de idempotência: a tela gera um UUID por operação. Reenviar a
 *    mesma operação (duplo clique, rede que caiu, F5) não grava de novo:
 *    devolve o que já foi registrado. Índice único no banco garante isso
 *    mesmo com duas requisições simultâneas.
 * 2. Ticket travado (SELECT ... FOR UPDATE) durante o registro: duas telas
 *    registrando ao mesmo tempo ficam em fila e a segunda vê o valor já pago.
 * 3. Nunca se recebe mais que o valor em aberto do ticket.
 * 4. Pagamento igual (mesma forma e valor) no mesmo ticket há poucos minutos
 *    pede confirmação explícita.
 */
import type { RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import type { PagamentoConferido } from '@estacionamento/calculo';
import type { Conexao } from '../../db/pool.js';
import { AppError } from '../../http/erros.js';

export const MINUTOS_SUSPEITA_DUPLICIDADE = 5;

export interface PagamentoParaGravar extends PagamentoConferido {
  autorizacao: string | null;
  chaveIdempotencia: string;
}

export interface PagamentoGravado {
  id: string;
  sessaoId: string;
  forma: string;
  valorCentavos: number;
  trocoCentavos: number;
  chaveIdempotencia: string;
  status: string;
}

/** Pagamentos já registrados com estas chaves (reenvio da mesma operação). */
export async function pagamentosPorChave(
  c: Conexao,
  chaves: string[],
): Promise<Map<string, PagamentoGravado>> {
  if (!chaves.length) return new Map();
  const [linhas] = await c.query<RowDataPacket[]>(
    `SELECT id, sessao_id, forma_codigo, valor_centavos, troco_centavos, chave_idempotencia, status
       FROM pagamentos WHERE chave_idempotencia IN (?)`,
    [chaves],
  );
  return new Map(
    linhas.map((l) => [
      String(l.chave_idempotencia),
      {
        id: String(l.id),
        sessaoId: String(l.sessao_id),
        forma: String(l.forma_codigo),
        valorCentavos: Number(l.valor_centavos),
        trocoCentavos: Number(l.troco_centavos),
        chaveIdempotencia: String(l.chave_idempotencia),
        status: String(l.status),
      },
    ]),
  );
}

/** A mesma chave usada para outro ticket ou com outros dados: erro da tela, nunca grava. */
export function chaveReusada(): AppError {
  return new AppError(
    409,
    'CONFLITO',
    'Esta operação já foi registrada com outros dados. Atualize a tela antes de tentar de novo.',
    { motivo: 'CHAVE_REUTILIZADA' },
  );
}

/** Pagamento igual registrado há pouco no mesmo ticket (possível duplo lançamento). */
export async function pagamentoParecido(
  c: Conexao,
  sessaoId: string,
  forma: string,
  valorCentavos: number,
): Promise<{ id: string; registradoEm: Date } | null> {
  const [[l]] = await c.query<RowDataPacket[]>(
    `SELECT id, registrado_em FROM pagamentos
      WHERE sessao_id = ? AND forma_codigo = ? AND valor_centavos = ? AND status = 'CONFIRMADO'
        AND registrado_em >= NOW(3) - INTERVAL ? MINUTE
      ORDER BY registrado_em DESC LIMIT 1`,
    [sessaoId, forma, valorCentavos, MINUTOS_SUSPEITA_DUPLICIDADE],
  );
  return l ? { id: String(l.id), registradoEm: l.registrado_em as Date } : null;
}

/** Grava os pagamentos e a entrada de cada um no caixa (mesma transação do chamador). */
export async function gravarPagamentos(
  c: Conexao,
  o: {
    siteId: string;
    sessaoId: string;
    caixaId: string;
    operadorId: string;
    pagamentos: PagamentoParaGravar[];
  },
): Promise<string[]> {
  const ids: string[] = [];
  for (const p of o.pagamentos) {
    const id = ulid();
    ids.push(id);
    await c.query(
      `INSERT INTO pagamentos (id, site_id, sessao_id, caixa_sessao_id, forma_codigo, valor_centavos, valor_recebido_centavos,
                               troco_centavos, autorizacao, parcelas, chave_idempotencia, registrado_por, registrado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
      [
        id,
        o.siteId,
        o.sessaoId,
        o.caixaId,
        p.forma,
        p.valorCentavos,
        p.valorRecebidoCentavos,
        p.trocoCentavos,
        p.autorizacao,
        p.parcelas,
        p.chaveIdempotencia,
        o.operadorId,
      ],
    );
    await c.query(
      `INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo,
                                              pagamento_id, sessao_id, registrado_por, registrado_em)
       VALUES (?, ?, ?, 'RECEBIMENTO', 'ENTRADA', ?, ?, ?, ?, ?, NOW(3))`,
      [ulid(), o.siteId, o.caixaId, p.valorCentavos, p.forma, id, o.sessaoId, o.operadorId],
    );
  }
  return ids;
}
