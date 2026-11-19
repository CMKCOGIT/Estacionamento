import type { Conexao } from './pool.js';
import { pool } from './pool.js';

/**
 * Registra no histórico eventos que NÃO alteram dados (origem 'APP'):
 * login, falha de login, logout... As alterações de dados são registradas
 * automaticamente pelos triggers (origem 'DB').
 */
export interface Atividade {
  acao: string;
  siteId?: string | null;
  usuarioId?: string | null;
  entidade?: string | null;
  entidadeId?: string | null;
  dados?: Record<string, unknown> | null;
  motivo?: string | null;
  ip?: string | null;
  correlacaoId?: string | null;
}

export async function registrarAtividade(a: Atividade, conexao?: Conexao): Promise<void> {
  await (conexao ?? pool).query(
    `INSERT INTO historico_atividades
       (site_id, usuario_id, acao, entidade, entidade_id, dados_novos, motivo, origem, ip, correlacao_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'APP', ?, ?)`,
    [
      a.siteId ?? null,
      a.usuarioId ?? null,
      a.acao,
      a.entidade ?? null,
      a.entidadeId ?? null,
      a.dados ? JSON.stringify(a.dados) : null,
      a.motivo ?? null,
      a.ip ?? null,
      a.correlacaoId ?? null,
    ],
  );
}
