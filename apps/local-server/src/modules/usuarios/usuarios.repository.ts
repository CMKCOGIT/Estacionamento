import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  FuncionarioDetalhe,
  FuncionarioResumo,
  NivelAcesso,
  SituacaoAcesso,
} from '@estacionamento/shared';
import type { Conexao } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

export const PERFIL_ID: Record<NivelAcesso, string> = {
  admin: '00000000000000000000000001',
  gerente: '00000000000000000000000005',
  funcionario: '00000000000000000000000004',
};

const flag = (v: unknown) => v !== null && v !== undefined && Number(v) !== 0;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const data = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : null);

/** Colunas comuns de listagem/detalhe (funcionário + acesso + nível no site). */
const SELECT_BASE = `
  SELECT f.id, f.nome, f.cargo, f.ativo, f.cpf, f.telefone, f.email,
         f.data_admissao, f.data_desligamento, f.criado_em, f.atualizado_em,
         u.id AS usuario_id, u.login, u.ativo AS usuario_ativo, u.deve_trocar_senha,
         u.bloqueado_ate, (u.bloqueado_ate IS NOT NULL AND u.bloqueado_ate > NOW(3)) AS bloqueado,
         u.ultimo_login_em,
         (SELECT p.codigo FROM usuario_perfis up JOIN perfis p ON p.id = up.perfil_id
           WHERE up.usuario_id = u.id AND up.site_id = f.site_id AND p.uso = 'NIVEL'
           ORDER BY FIELD(p.codigo, 'admin', 'gerente', 'funcionario') LIMIT 1) AS nivel
    FROM funcionarios f
    LEFT JOIN usuarios u ON u.id = f.usuario_id`;

function situacao(l: RowDataPacket): SituacaoAcesso {
  if (!flag(l.ativo)) return 'INATIVO';
  if (!l.usuario_id) return 'SEM_ACESSO';
  if (!flag(l.usuario_ativo)) return 'INATIVO';
  if (flag(l.bloqueado)) return 'BLOQUEADO';
  return 'ATIVO';
}

function paraResumo(l: RowDataPacket): FuncionarioResumo {
  return {
    id: l.id,
    nome: l.nome,
    cargo: l.cargo ?? null,
    ativo: flag(l.ativo),
    situacao: situacao(l),
    cadastradoEm: iso(l.criado_em) ?? '',
    acesso: l.usuario_id
      ? {
          usuarioId: l.usuario_id,
          login: l.login,
          nivel: (l.nivel as NivelAcesso | null) ?? null,
          ativo: flag(l.usuario_ativo),
          bloqueadoAte: flag(l.bloqueado) ? iso(l.bloqueado_ate) : null,
          deveTrocarSenha: flag(l.deve_trocar_senha),
          ultimoLoginEm: iso(l.ultimo_login_em),
        }
      : null,
  };
}

export interface FiltroListagem {
  busca?: string;
  situacao: 'ativos' | 'inativos' | 'todos';
  nivel?: NivelAcesso | 'sem_acesso';
}

export const usuariosRepository = {
  async listar(siteId: string, filtro: FiltroListagem): Promise<FuncionarioResumo[]> {
    const where = ['f.site_id = ?'];
    const params: unknown[] = [siteId];
    if (filtro.situacao === 'ativos') where.push('f.ativo = TRUE');
    if (filtro.situacao === 'inativos') where.push('f.ativo = FALSE');
    if (filtro.busca) {
      where.push('(f.nome LIKE ? OR u.login LIKE ? OR f.cargo LIKE ? OR f.cpf LIKE ?)');
      const termo = `%${filtro.busca.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(termo, termo, termo, `%${filtro.busca.replace(/\D/g, '') || '#'}%`);
    }
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM (${SELECT_BASE} WHERE ${where.join(' AND ')}) t
        ${filtro.nivel === 'sem_acesso' ? 'WHERE t.usuario_id IS NULL' : filtro.nivel ? 'WHERE t.nivel = ?' : ''}
        ORDER BY t.ativo DESC, t.nome`,
      filtro.nivel && filtro.nivel !== 'sem_acesso' ? [...params, filtro.nivel] : params,
    );
    return linhas.map(paraResumo);
  },

  async buscar(siteId: string, id: string, c?: Conexao): Promise<FuncionarioDetalhe | null> {
    const [linhas] = await (c ?? pool).query<RowDataPacket[]>(
      `${SELECT_BASE} WHERE f.site_id = ? AND f.id = ?`,
      [siteId, id],
    );
    const l = linhas[0];
    if (!l) return null;
    let permissoes: string[] = [];
    let sessoesAtivas = 0;
    if (l.usuario_id) {
      const [p] = await (c ?? pool).query<RowDataPacket[]>(
        'SELECT permissao_codigo FROM usuario_permissoes WHERE usuario_id = ? AND site_id = ? ORDER BY 1',
        [l.usuario_id, siteId],
      );
      permissoes = p.map((x) => String(x.permissao_codigo));
      const [[s]] = await (c ?? pool).query<RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM sessoes_acesso WHERE usuario_id = ? AND encerrada_em IS NULL AND expira_em > NOW(3)',
        [l.usuario_id],
      );
      sessoesAtivas = Number(s?.n ?? 0);
    }
    return {
      ...paraResumo(l),
      cpf: l.cpf ?? null,
      telefone: l.telefone ?? null,
      email: l.email ?? null,
      dataAdmissao: data(l.data_admissao),
      dataDesligamento: data(l.data_desligamento),
      permissoes,
      sessoesAtivas,
      criadoEm: iso(l.criado_em) ?? '',
      atualizadoEm: iso(l.atualizado_em) ?? '',
    };
  },

  async inserirFuncionario(
    c: Conexao,
    f: {
      id: string;
      siteId: string;
      nome: string;
      cpf: string | null;
      telefone: string | null;
      email: string | null;
      cargo: string | null;
      dataAdmissao: string | null;
      usuarioId: string | null;
    },
  ) {
    await c.query(
      `INSERT INTO funcionarios (id, site_id, usuario_id, nome, cpf, telefone, email, cargo, data_admissao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [f.id, f.siteId, f.usuarioId, f.nome, f.cpf, f.telefone, f.email, f.cargo, f.dataAdmissao],
    );
  },

  async atualizarFuncionario(
    c: Conexao,
    id: string,
    f: {
      nome: string;
      cpf: string | null;
      telefone: string | null;
      email: string | null;
      cargo: string | null;
      dataAdmissao: string | null;
    },
  ) {
    await c.query(
      'UPDATE funcionarios SET nome = ?, cpf = ?, telefone = ?, email = ?, cargo = ?, data_admissao = ? WHERE id = ?',
      [f.nome, f.cpf, f.telefone, f.email, f.cargo, f.dataAdmissao, id],
    );
  },

  async vincularUsuario(c: Conexao, funcionarioId: string, usuarioId: string) {
    await c.query('UPDATE funcionarios SET usuario_id = ? WHERE id = ?', [usuarioId, funcionarioId]);
  },

  async inserirUsuario(
    c: Conexao,
    u: { id: string; login: string; email: string | null; senhaHash: string },
  ) {
    await c.query(
      'INSERT INTO usuarios (id, login, email, senha_hash, deve_trocar_senha) VALUES (?, ?, ?, ?, TRUE)',
      [u.id, u.login, u.email, u.senhaHash],
    );
  },

  async atualizarLogin(c: Conexao, usuarioId: string, login: string) {
    await c.query('UPDATE usuarios SET login = ? WHERE id = ?', [login, usuarioId]);
  },

  async loginEmUso(c: Conexao, login: string, exceto: string | null): Promise<boolean> {
    const [l] = await c.query<RowDataPacket[]>(
      'SELECT 1 FROM usuarios WHERE login = ? AND (? IS NULL OR id <> ?)',
      [login, exceto, exceto],
    );
    return l.length > 0;
  },

  /** Deixa o usuário com exatamente um nível no site. */
  async definirNivel(
    c: Conexao,
    usuarioId: string,
    siteId: string,
    nivel: NivelAcesso,
    concedidoPor: string,
  ) {
    await c.query(
      `DELETE up FROM usuario_perfis up JOIN perfis p ON p.id = up.perfil_id
        WHERE up.usuario_id = ? AND up.site_id = ? AND p.uso = 'NIVEL' AND up.perfil_id <> ?`,
      [usuarioId, siteId, PERFIL_ID[nivel]],
    );
    await c.query(
      'INSERT IGNORE INTO usuario_perfis (usuario_id, site_id, perfil_id, concedido_por) VALUES (?, ?, ?, ?)',
      [usuarioId, siteId, PERFIL_ID[nivel], concedidoPor],
    );
  },

  /** Grava só as diferenças (o histórico registra cada concessão/remoção). */
  async definirPermissoes(
    c: Conexao,
    usuarioId: string,
    siteId: string,
    permissoes: string[],
    concedidoPor: string,
  ) {
    const [atuais] = await c.query<RowDataPacket[]>(
      'SELECT permissao_codigo FROM usuario_permissoes WHERE usuario_id = ? AND site_id = ?',
      [usuarioId, siteId],
    );
    const antes = new Set(atuais.map((l) => String(l.permissao_codigo)));
    const depois = new Set(permissoes);
    const remover = [...antes].filter((p) => !depois.has(p));
    const incluir = [...depois].filter((p) => !antes.has(p));
    if (remover.length) {
      await c.query(
        'DELETE FROM usuario_permissoes WHERE usuario_id = ? AND site_id = ? AND permissao_codigo IN (?)',
        [usuarioId, siteId, remover],
      );
    }
    if (incluir.length) {
      await c.query(
        'INSERT INTO usuario_permissoes (usuario_id, site_id, permissao_codigo, concedido_por) VALUES ?',
        [incluir.map((p) => [usuarioId, siteId, p, concedidoPor])],
      );
    }
    return { incluidas: incluir, removidas: remover };
  },

  /** Administradores ativos no site (trava as linhas para evitar corrida). */
  async contarAdminsAtivos(c: Conexao, siteId: string, exceto: string | null): Promise<number> {
    const [linhas] = await c.query<RowDataPacket[]>(
      `SELECT u.id FROM usuarios u
         JOIN usuario_perfis up ON up.usuario_id = u.id AND up.site_id = ? AND up.perfil_id = ?
        WHERE u.ativo = TRUE AND (? IS NULL OR u.id <> ?)
        FOR UPDATE`,
      [siteId, PERFIL_ID.admin, exceto, exceto],
    );
    return linhas.length;
  },

  async definirAtivo(c: Conexao, funcionarioId: string, usuarioId: string | null, ativo: boolean) {
    await c.query(
      `UPDATE funcionarios
          SET ativo = ?, data_desligamento = IF(?, NULL, COALESCE(data_desligamento, GREATEST(CURRENT_DATE, COALESCE(data_admissao, CURRENT_DATE))))
        WHERE id = ?`,
      [ativo, ativo, funcionarioId],
    );
    if (usuarioId) {
      await c.query('UPDATE usuarios SET ativo = ?, desativado_em = IF(?, NULL, NOW(3)) WHERE id = ?', [
        ativo,
        ativo,
        usuarioId,
      ]);
    }
  },

  async redefinirSenha(c: Conexao, usuarioId: string, senhaHash: string) {
    await c.query(
      `UPDATE usuarios SET senha_hash = ?, deve_trocar_senha = TRUE, senha_alterada_em = NOW(3),
              tentativas_falhas = 0, bloqueado_ate = NULL
        WHERE id = ?`,
      [senhaHash, usuarioId],
    );
  },

  async desbloquear(c: Conexao, usuarioId: string): Promise<boolean> {
    const [r] = await c.query<ResultSetHeader>(
      'UPDATE usuarios SET tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = ? AND bloqueado_ate IS NOT NULL',
      [usuarioId],
    );
    return r.affectedRows > 0;
  },

  async permissoesExistentes(codigos: string[]): Promise<Set<string>> {
    if (!codigos.length) return new Set();
    const [l] = await pool.query<RowDataPacket[]>('SELECT codigo FROM permissoes WHERE codigo IN (?)', [
      codigos,
    ]);
    return new Set(l.map((x) => String(x.codigo)));
  },
};
