import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { PerfilResumo } from '@estacionamento/shared';
import type { Conexao } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

/**
 * SQL do módulo de autenticação. Todas as comparações de horário usam o
 * relógio do MySQL (NOW(3), em UTC) para não depender do relógio do Node.
 */

/**
 * Expressões booleanas calculadas no SQL voltam como BIGINT e, com
 * `bigNumberStrings`, chegam como "0"/"1" — e Boolean("0") é true!
 * Por isso toda flag calculada passa por aqui.
 */
function flag(valor: unknown): boolean {
  return valor !== null && valor !== undefined && Number(valor) !== 0;
}

export interface UsuarioParaLogin {
  id: string;
  login: string;
  senhaHash: string;
  ativo: boolean;
  deveTrocarSenha: boolean;
  nome: string;
  tentativasFalhas: number;
  bloqueado: boolean;
  bloqueioExpirado: boolean;
  segundosDeBloqueio: number;
}

export type MotivoEncerramento =
  'LOGOUT' | 'EXPIRADA' | 'INATIVIDADE' | 'SENHA_ALTERADA' | 'USUARIO_DESATIVADO' | 'REVOGADA';

export interface SessaoComUsuario {
  id: string;
  usuarioId: string;
  siteId: string;
  expiraEm: Date;
  encerrada: boolean;
  expirou: boolean;
  inativa: boolean;
  segundosDesdeUso: number;
  login: string;
  usuarioAtivo: boolean;
  deveTrocarSenha: boolean;
  nome: string;
}

export const authRepository = {
  /** Trava a linha do usuário (FOR UPDATE) para contar tentativas sem condição de corrida. */
  async buscarUsuarioParaLogin(c: Conexao, login: string): Promise<UsuarioParaLogin | null> {
    const [linhas] = await c.query<RowDataPacket[]>(
      `SELECT u.id, u.login, u.senha_hash, u.ativo, u.deve_trocar_senha, u.tentativas_falhas,
              COALESCE(f.nome, u.login) AS nome,
              (u.bloqueado_ate IS NOT NULL AND u.bloqueado_ate >  NOW(3)) AS bloqueado,
              (u.bloqueado_ate IS NOT NULL AND u.bloqueado_ate <= NOW(3)) AS bloqueio_expirado,
              GREATEST(TIMESTAMPDIFF(SECOND, NOW(3), u.bloqueado_ate), 0) AS segundos_bloqueio
         FROM usuarios u
         LEFT JOIN funcionarios f ON f.usuario_id = u.id
        WHERE u.login = ?
        FOR UPDATE OF u`,
      [login],
    );
    const l = linhas[0];
    if (!l) return null;
    return {
      id: l.id,
      login: l.login,
      senhaHash: l.senha_hash,
      ativo: flag(l.ativo),
      deveTrocarSenha: flag(l.deve_trocar_senha),
      nome: l.nome,
      tentativasFalhas: Number(l.tentativas_falhas),
      bloqueado: flag(l.bloqueado),
      bloqueioExpirado: flag(l.bloqueio_expirado),
      segundosDeBloqueio: Number(l.segundos_bloqueio ?? 0),
    };
  },

  async registrarFalha(c: Conexao, usuarioId: string, tentativas: number, bloquearMinutos: number | null) {
    await c.query(
      `UPDATE usuarios
          SET tentativas_falhas = ?,
              bloqueado_ate = IF(? IS NULL, NULL, NOW(3) + INTERVAL ? MINUTE)
        WHERE id = ?`,
      [tentativas, bloquearMinutos, bloquearMinutos ?? 0, usuarioId],
    );
  },

  async registrarSucesso(c: Conexao, usuarioId: string) {
    await c.query(
      'UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL, ultimo_login_em = NOW(3) WHERE id = ?',
      [usuarioId],
    );
  },

  async dadosBasicosUsuario(
    usuarioId: string,
  ): Promise<{ login: string; nome: string; deveTrocarSenha: boolean } | null> {
    const [[l]] = await pool.query<RowDataPacket[]>(
      `SELECT u.login, u.deve_trocar_senha, COALESCE(f.nome, u.login) AS nome
         FROM usuarios u LEFT JOIN funcionarios f ON f.usuario_id = u.id
        WHERE u.id = ?`,
      [usuarioId],
    );
    return l
      ? { login: String(l.login), nome: String(l.nome), deveTrocarSenha: flag(l.deve_trocar_senha) }
      : null;
  },

  async perfisDoUsuario(usuarioId: string, siteId: string, c?: Conexao): Promise<PerfilResumo[]> {
    const [linhas] = await (c ?? pool).query<RowDataPacket[]>(
      `SELECT p.codigo, p.nome
         FROM usuario_perfis up
         JOIN perfis p ON p.id = up.perfil_id AND p.ativo = TRUE
        WHERE up.usuario_id = ? AND up.site_id = ?
        ORDER BY p.nome`,
      [usuarioId, siteId],
    );
    return linhas.map((l) => ({ codigo: String(l.codigo), nome: String(l.nome) }));
  },

  async permissoesDoUsuario(usuarioId: string, siteId: string): Promise<string[]> {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT pp.permissao_codigo AS codigo
         FROM usuario_perfis up
         JOIN perfis p             ON p.id = up.perfil_id AND p.ativo = TRUE
         JOIN perfil_permissoes pp ON pp.perfil_id = p.id
        WHERE up.usuario_id = ? AND up.site_id = ?
        ORDER BY codigo`,
      [usuarioId, siteId],
    );
    return linhas.map((l) => String(l.codigo));
  },

  async criarSessao(
    c: Conexao,
    s: {
      id: string;
      usuarioId: string;
      siteId: string;
      tokenHash: Buffer;
      duracaoHoras: number;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<Date> {
    await c.query(
      `INSERT INTO sessoes_acesso (id, usuario_id, site_id, token_hash, expira_em, ip, user_agent)
       VALUES (?, ?, ?, ?, NOW(3) + INTERVAL ? HOUR, ?, ?)`,
      [s.id, s.usuarioId, s.siteId, s.tokenHash, s.duracaoHoras, s.ip, s.userAgent?.slice(0, 255) ?? null],
    );
    const [[linha]] = await c.query<RowDataPacket[]>('SELECT expira_em FROM sessoes_acesso WHERE id = ?', [
      s.id,
    ]);
    return linha?.expira_em as Date;
  },

  async buscarSessaoPorToken(tokenHash: Buffer, inatividadeMin: number): Promise<SessaoComUsuario | null> {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.usuario_id, s.site_id, s.expira_em,
              (s.encerrada_em IS NOT NULL)                             AS encerrada,
              (s.expira_em <= NOW(3))                                  AS expirou,
              (s.ultimo_uso_em <= NOW(3) - INTERVAL ? MINUTE)          AS inativa,
              TIMESTAMPDIFF(SECOND, s.ultimo_uso_em, NOW(3))           AS segundos_desde_uso,
              u.login, u.ativo, u.deve_trocar_senha, COALESCE(f.nome, u.login) AS nome
         FROM sessoes_acesso s
         JOIN usuarios u          ON u.id = s.usuario_id
         LEFT JOIN funcionarios f ON f.usuario_id = u.id
        WHERE s.token_hash = ?`,
      [inatividadeMin, tokenHash],
    );
    const l = linhas[0];
    if (!l) return null;
    return {
      id: l.id,
      usuarioId: l.usuario_id,
      siteId: l.site_id,
      expiraEm: l.expira_em,
      encerrada: flag(l.encerrada),
      expirou: flag(l.expirou),
      inativa: flag(l.inativa),
      segundosDesdeUso: Number(l.segundos_desde_uso),
      login: l.login,
      usuarioAtivo: flag(l.ativo),
      deveTrocarSenha: flag(l.deve_trocar_senha),
      nome: l.nome,
    };
  },

  async tocarSessao(sessaoId: string) {
    await pool.query(
      'UPDATE sessoes_acesso SET ultimo_uso_em = NOW(3) WHERE id = ? AND encerrada_em IS NULL',
      [sessaoId],
    );
  },

  async encerrarSessao(sessaoId: string, motivo: MotivoEncerramento, c?: Conexao) {
    await (c ?? pool).query(
      'UPDATE sessoes_acesso SET encerrada_em = NOW(3), motivo_encerramento = ? WHERE id = ? AND encerrada_em IS NULL',
      [motivo, sessaoId],
    );
  },

  async encerrarOutrasSessoes(
    c: Conexao,
    usuarioId: string,
    motivo: MotivoEncerramento,
    excetoId: string | null,
  ) {
    const [r] = await c.query<ResultSetHeader>(
      `UPDATE sessoes_acesso SET encerrada_em = NOW(3), motivo_encerramento = ?
        WHERE usuario_id = ? AND encerrada_em IS NULL AND (? IS NULL OR id <> ?)`,
      [motivo, usuarioId, excetoId, excetoId],
    );
    return r.affectedRows;
  },

  /** Marca como encerradas as sessões vencidas (rotina periódica). */
  async encerrarSessoesVencidas(inatividadeMin: number): Promise<number> {
    const [r] = await pool.query<ResultSetHeader>(
      `UPDATE sessoes_acesso
          SET encerrada_em = NOW(3),
              motivo_encerramento = IF(expira_em <= NOW(3), 'EXPIRADA', 'INATIVIDADE')
        WHERE encerrada_em IS NULL
          AND (expira_em <= NOW(3) OR ultimo_uso_em <= NOW(3) - INTERVAL ? MINUTE)`,
      [inatividadeMin],
    );
    return r.affectedRows;
  },

  async buscarHashSenha(c: Conexao, usuarioId: string): Promise<string | null> {
    const [[linha]] = await c.query<RowDataPacket[]>(
      'SELECT senha_hash FROM usuarios WHERE id = ? FOR UPDATE',
      [usuarioId],
    );
    return linha ? String(linha.senha_hash) : null;
  },

  async atualizarSenha(c: Conexao, usuarioId: string, senhaHash: string) {
    await c.query(
      'UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = FALSE, senha_alterada_em = NOW(3) WHERE id = ?',
      [senhaHash, usuarioId],
    );
  },
};
