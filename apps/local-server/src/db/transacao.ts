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
  /**
   * SOMENTE a rotina de retenção/anonimização (LGPD): libera as travas que
   * protegem tickets encerrados e o histórico, para remover dados pessoais.
   */
  retencao?: boolean;
}

const LIMPAR_VARIAVEIS =
  'SET @app_usuario_id = NULL, @app_motivo = NULL, @app_posto_id = NULL, @app_correlacao_id = NULL, @app_retencao = NULL';

/** Deadlock: o MySQL desfaz uma das transações e recomenda repeti-la. */
const ER_LOCK_DEADLOCK = 1213;
/** Vários guichês ao mesmo tempo (ex.: pico de entradas) podem colidir mais de uma vez. */
export const TENTATIVAS_DEADLOCK = 6;

/**
 * Executa `fn` dentro de uma transação, com as variáveis de auditoria definidas.
 * Se o MySQL abortar por deadlock (duas operações disputando as mesmas linhas,
 * ex.: dois operadores na mesma vaga), a transação inteira é repetida — na
 * repetição as regras do banco decidem com clareza (ex.: "vaga já ocupada").
 * `fn` não deve ter efeitos fora do banco, pois pode rodar mais de uma vez.
 */
export async function comTransacao<T>(
  contexto: ContextoAuditoria,
  fn: (conexao: Conexao) => Promise<T>,
): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await executarTransacao(contexto, fn);
    } catch (erro) {
      const deadlock = (erro as { errno?: number }).errno === ER_LOCK_DEADLOCK;
      if (!deadlock || tentativa >= TENTATIVAS_DEADLOCK) throw erro;
      logger.warn({ tentativa }, 'Deadlock no MySQL: repetindo a transação');
      // Espera crescente e aleatória: as transações que colidiram não voltam juntas
      await new Promise((r) => setTimeout(r, 25 * 2 ** (tentativa - 1) + Math.random() * 50));
    }
  }
}

/**
 * Uma tentativa: COMMIT se `fn` terminar, ROLLBACK se lançar erro, e sempre
 * limpa as variáveis antes de devolver a conexão ao pool (evita vazar o
 * usuário de uma requisição para outra).
 */
async function executarTransacao<T>(
  contexto: ContextoAuditoria,
  fn: (conexao: Conexao) => Promise<T>,
): Promise<T> {
  const conexao = await pool.getConnection();
  let conexaoSegura = true;
  try {
    await conexao.query(
      'SET @app_usuario_id = ?, @app_motivo = ?, @app_posto_id = ?, @app_correlacao_id = ?, @app_retencao = ?',
      [
        contexto.usuarioId ?? null,
        contexto.motivo ?? null,
        contexto.postoId ?? null,
        contexto.correlacaoId ?? null,
        contexto.retencao ? 1 : null,
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
