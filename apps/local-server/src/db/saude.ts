import type { RowDataPacket } from 'mysql2/promise';
import type { StatusSistema } from '@estacionamento/shared';
import { pool } from './pool.js';

interface LinhaSaude extends RowDataPacket {
  versao: string;
  banco: string | null;
}

/** Verifica se o MySQL responde e qual banco/versão está em uso. */
export async function verificarBanco(): Promise<StatusSistema['banco']> {
  const inicio = performance.now();
  try {
    const [linhas] = await pool.query<LinhaSaude[]>('SELECT VERSION() AS versao, DATABASE() AS banco');
    const linha = linhas[0];
    return {
      ok: true,
      versao: linha?.versao,
      nome: linha?.banco ?? undefined,
      latenciaMs: Math.round(performance.now() - inicio),
    };
  } catch (erro) {
    return { ok: false, erro: descreverErroConexao(erro) };
  }
}

export function descreverErroConexao(erro: unknown): string {
  const e = erro as { code?: string; message?: string };
  switch (e.code) {
    case 'ECONNREFUSED':
      return 'MySQL não está aceitando conexões (o serviço está parado?)';
    case 'ER_ACCESS_DENIED_ERROR':
      return 'Usuário ou senha do MySQL incorretos (verifique DB_USER/DB_PASSWORD)';
    case 'ER_BAD_DB_ERROR':
      return 'Banco de dados não encontrado (verifique DB_NAME e se os scripts foram executados)';
    case 'ETIMEDOUT':
      return 'Tempo esgotado ao conectar no MySQL (verifique DB_HOST/DB_PORT)';
    default:
      return e.message ?? 'Erro desconhecido ao conectar no MySQL';
  }
}
