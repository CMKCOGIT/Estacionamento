import type { RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { ulid } from 'ulid';
import { pool } from '../../src/db/pool.js';
import { gerarHashSenha } from '../../src/modules/auth/senha.js';
import { criarAdministrador } from '../../src/modules/instalacao/instalacao.service.js';

export const ADMIN = { login: 'admin', senha: 'Painel2026x', nome: 'Ana Administradora' };

/** Garante (uma vez por banco de teste) o estacionamento e o admin. */
export async function garantirAdmin(): Promise<{ siteId: string; usuarioId: string }> {
  const [linhas] = await pool.query<RowDataPacket[]>(
    'SELECT u.id, up.site_id FROM usuarios u JOIN usuario_perfis up ON up.usuario_id = u.id WHERE u.login = ?',
    [ADMIN.login],
  );
  if (linhas[0]) return { siteId: linhas[0].site_id, usuarioId: linhas[0].id };
  const r = await criarAdministrador({ ...ADMIN, nomeEstacionamento: 'Estacionamento Teste' });
  return { siteId: r.siteId, usuarioId: r.usuarioId };
}

const PERFIS = {
  admin: '00000000000000000000000001',
  funcionario: '00000000000000000000000004',
  gerente: '00000000000000000000000005',
} as const;

/** Cria um usuário de teste direto no banco (sem funcionário vinculado). */
export async function criarUsuario(opcoes: {
  login: string;
  senha: string;
  perfil?: keyof typeof PERFIS | null;
  /** Nível Funcionário: padrão = permissões do modelo "Operador de caixa". */
  permissoes?: string[];
  deveTrocarSenha?: boolean;
}): Promise<string> {
  const { siteId } = await garantirAdmin();
  const id = ulid();
  await pool.query('INSERT INTO usuarios (id, login, senha_hash, deve_trocar_senha) VALUES (?, ?, ?, ?)', [
    id,
    opcoes.login,
    await gerarHashSenha(opcoes.senha),
    opcoes.deveTrocarSenha ?? false,
  ]);
  const perfil = opcoes.perfil === undefined ? 'funcionario' : opcoes.perfil;
  if (perfil) {
    await pool.query('INSERT INTO usuario_perfis (usuario_id, site_id, perfil_id) VALUES (?, ?, ?)', [
      id,
      siteId,
      PERFIS[perfil],
    ]);
  }
  if (perfil === 'funcionario' || perfil === 'gerente') {
    const permissoes =
      opcoes.permissoes ??
      (
        await pool.query<RowDataPacket[]>(
          "SELECT pp.permissao_codigo AS c FROM perfil_permissoes pp JOIN perfis p ON p.id = pp.perfil_id WHERE p.codigo = 'operador'",
        )
      )[0].map((l) => String(l.c));
    if (permissoes.length) {
      await pool.query('INSERT INTO usuario_permissoes (usuario_id, site_id, permissao_codigo) VALUES ?', [
        permissoes.map((p) => [id, siteId, p]),
      ]);
    }
  }
  return id;
}

/** Faz login e devolve um agente com o cookie de sessão. */
export async function entrar(app: Parameters<typeof request.agent>[0], login: string, senha: string) {
  const agente = request.agent(app);
  const res = await agente.post('/api/v1/auth/login').send({ login, senha });
  if (res.status !== 200)
    throw new Error(`Login de ${login} falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return agente;
}
