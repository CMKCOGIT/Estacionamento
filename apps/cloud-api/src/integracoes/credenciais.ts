import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

/**
 * Integrações = sistemas que ESCREVEM na nuvem (hoje: o servidor local de
 * cada estacionamento). Cada uma tem escopos; a rota exige o escopo dela.
 * Preparado para parceiros futuros (tipo PARCEIRO), sem mudar a autenticação.
 */
export type Escopo = 'sync:escrever' | 'sync:ler';

export const ESCOPOS_SERVIDOR_LOCAL: Escopo[] = ['sync:escrever', 'sync:ler'];

export interface Integracao {
  id: string;
  siteId: string | null;
  tipo: 'SERVIDOR_LOCAL' | 'PARCEIRO';
  nome: string;
  escopos: Escopo[];
  versaoChave: number;
  anteriorValidaAte: Date | null;
  ativo: boolean;
}

/**
 * Segredo da integração = HMAC-SHA256(chave mestra, "integracao:<id>:<versão>").
 * Não fica guardado no banco: um vazamento do banco não entrega segredos.
 */
export function derivarSegredo(id: string, versao: number, chaveMestra = env.SYNC_CHAVE_MESTRA): string {
  if (!chaveMestra) throw new Error('SYNC_CHAVE_MESTRA não configurada');
  return createHmac('sha256', chaveMestra).update(`integracao:${id}:${versao}`).digest('base64url');
}

export function sha256Hex(dados: Buffer | string): string {
  return createHash('sha256').update(dados).digest('hex');
}

export function assinaturaConfere(segredo: string, texto: string, recebida: string): boolean {
  const esperada = Buffer.from(createHmac('sha256', segredo).update(texto).digest('hex'), 'utf8');
  const veio = Buffer.from(recebida, 'utf8');
  return esperada.length === veio.length && timingSafeEqual(esperada, veio);
}

export const integracoesRepository = {
  async obter(id: string): Promise<Integracao | null> {
    const [[l]] = await pool.query<RowDataPacket[]>('SELECT * FROM integracoes WHERE id = ?', [id]);
    if (!l) return null;
    return {
      id: String(l.id),
      siteId: (l.site_id as string | null) ?? null,
      tipo: l.tipo,
      nome: String(l.nome),
      escopos: (typeof l.escopos === 'string' ? JSON.parse(l.escopos) : l.escopos) as Escopo[],
      versaoChave: Number(l.versao_chave),
      anteriorValidaAte: (l.anterior_valida_ate as Date | null) ?? null,
      ativo: Boolean(Number(l.ativo)),
    };
  },

  /** Primeiro uso de uma credencial sem estacionamento: fica presa a ele para sempre. */
  async vincularSite(id: string, siteId: string): Promise<boolean> {
    const [r] = await pool.query<ResultSetHeader>(
      'UPDATE integracoes SET site_id = ? WHERE id = ? AND site_id IS NULL',
      [siteId, id],
    );
    return r.affectedRows === 1;
  },

  async marcarUso(id: string) {
    await pool.query('UPDATE integracoes SET ultimo_uso_em = NOW(3) WHERE id = ?', [id]);
  },

  /** Nonce já visto = requisição repetida (replay). */
  async usarNonce(integracaoId: string, nonce: string): Promise<boolean> {
    const [r] = await pool.query<ResultSetHeader>(
      'INSERT IGNORE INTO sync_nonces (integracao_id, nonce) VALUES (?, ?)',
      [integracaoId, nonce],
    );
    return r.affectedRows === 1;
  },
};
