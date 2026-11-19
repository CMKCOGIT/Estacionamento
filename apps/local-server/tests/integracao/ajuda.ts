import type { RowDataPacket } from 'mysql2/promise';
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
  operador: '00000000000000000000000002',
  financeiro: '00000000000000000000000003',
} as const;

/** Cria um usuário de teste direto no banco. */
export async function criarUsuario(opcoes: {
  login: string;
  senha: string;
  perfil?: keyof typeof PERFIS | null;
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
  const perfil = opcoes.perfil === undefined ? 'operador' : opcoes.perfil;
  if (perfil) {
    await pool.query('INSERT INTO usuario_perfis (usuario_id, site_id, perfil_id) VALUES (?, ?, ?)', [
      id,
      siteId,
      PERFIS[perfil],
    ]);
  }
  return id;
}
