import { logger } from '../config/logger.js';
import { pool, type Conexao } from './pool.js';

/**
 * Dados lidos pelos triggers de auditoria (ver database/local/002_triggers.sql).
 * Toda escrita importante deve passar por `comTransacao` informando o contexto.
 */
export interface ContextoAuditoria {
  usuarioId?: string | null;
  motivo?: string | null;
  postoId?: string | null;
  correlacaoId?: string | null;
}

const LIMPAR_VARIAVEIS =
  'SET @app_usuario_id = NULL, @app_motivo = NULL, @app_posto_id = NULL, @app_correlacao_id = NULL, @app_retencao = NULL';

/**
 * Executa `fn` dentro de uma transação, com as variáveis de auditoria definidas.
 * Faz COMMIT se `fn` terminar, ROLLBACK se lançar erro, e sempre limpa as
 * variáveis antes de devolver a conexão ao pool (evita vazar o usuário de uma
 * requisição para outra).
 */
export async function comTransacao<T>(
  contexto: ContextoAuditoria,
  fn: (conexao: Conexao) => Promise<T>,
): Promise<T> {
  const conexao = await pool.getConnection();
  let conexaoSegura = true;
  try {
    await conexao.query(
      'SET @app_usuario_id = ?, @app_motivo = ?, @app_posto_id = ?, @app_correlacao_id = ?',
      [
        contexto.usuarioId ?? null,
        contexto.motivo ?? null,
        contexto.postoId ?? null,
        contexto.correlacaoId ?? null,
      ],
    );
    await conexao.beginTransaction();
    try {
      const resultado = await fn(conexao);
      await conexao.commit();
      return resultado;
    } catch (erro) {
      await conexao.rollback().catch((e: unknown) => {
        conexaoSegura = false;
        logger.error({ err: e }, 'Falha no ROLLBACK');
      });
      throw erro;
    }
  } finally {
    try {
      await conexao.query(LIMPAR_VARIAVEIS);
    } catch {
      conexaoSegura = false;
    }
    if (conexaoSegura) conexao.release();
    else conexao.destroy();
  }
}
