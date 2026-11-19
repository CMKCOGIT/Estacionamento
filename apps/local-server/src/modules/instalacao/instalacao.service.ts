import type { RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import { problemasDaSenha } from '@estacionamento/shared';
import { esquecerSiteAtual } from '../../config/site.js';
import { pool } from '../../db/pool.js';
import { comTransacao } from '../../db/transacao.js';
import { AppError } from '../../http/erros.js';
import { normalizarLogin } from '../auth/auth.service.js';
import { gerarHashSenha } from '../auth/senha.js';

/** ID fixo do perfil admin (database/local/004_seed.sql). */
export const PERFIL_ADMIN_ID = '00000000000000000000000001';

export interface DadosAdministrador {
  /** Usado só se ainda não existir estacionamento cadastrado. */
  nomeEstacionamento?: string;
  slugEstacionamento?: string;
  nome: string;
  login: string;
  senha: string;
}

export function gerarSlug(texto: string): string {
  return (
    texto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'estacionamento'
  );
}

/**
 * Configuração inicial: cria o estacionamento (se não houver) e um usuário
 * administrador com funcionário vinculado. Usado pelo comando
 * `npm run usuario:admin` e pelos testes.
 */
export async function criarAdministrador(dados: DadosAdministrador) {
  const login = normalizarLogin(dados.login);
  if (!/^[a-z0-9._-]{3,60}$/.test(login)) {
    throw new AppError(
      400,
      'REQUISICAO_INVALIDA',
      'Login deve ter 3 a 60 caracteres: letras, números, ponto, - ou _',
    );
  }
  const problemas = problemasDaSenha(dados.senha, login);
  if (problemas.length)
    throw new AppError(400, 'REQUISICAO_INVALIDA', `Senha fraca: ${problemas.join('; ')}`);
  if (!dados.nome.trim()) throw new AppError(400, 'REQUISICAO_INVALIDA', 'Informe o nome do administrador');

  const senhaHash = await gerarHashSenha(dados.senha);

  const resultado = await comTransacao({ motivo: 'configuração inicial' }, async (c) => {
    const [sites] = await c.query<RowDataPacket[]>(
      'SELECT id, nome FROM sites WHERE ativo = TRUE ORDER BY criado_em',
    );
    let siteId = sites[0]?.id as string | undefined;
    let siteCriado = false;
    if (!siteId) {
      const nome = dados.nomeEstacionamento?.trim();
      if (!nome) throw new AppError(400, 'REQUISICAO_INVALIDA', 'Informe o nome do estacionamento');
      siteId = ulid();
      await c.query('INSERT INTO sites (id, slug, nome) VALUES (?, ?, ?)', [
        siteId,
        dados.slugEstacionamento ?? gerarSlug(nome),
        nome,
      ]);
      await c.query('INSERT INTO sync_estado (site_id) VALUES (?)', [siteId]);
      siteCriado = true;
    }

    const [existe] = await c.query<RowDataPacket[]>('SELECT 1 FROM usuarios WHERE login = ?', [login]);
    if (existe.length)
      throw new AppError(409, 'REGISTRO_DUPLICADO', `Já existe um usuário com o login "${login}"`);

    const usuarioId = ulid();
    // O próprio admin escolheu a senha: não precisa trocar no primeiro acesso.
    await c.query('INSERT INTO usuarios (id, login, senha_hash, deve_trocar_senha) VALUES (?, ?, ?, FALSE)', [
      usuarioId,
      login,
      senhaHash,
    ]);
    await c.query(
      "INSERT INTO funcionarios (id, site_id, usuario_id, nome, cargo, data_admissao) VALUES (?, ?, ?, ?, 'Administrador', CURRENT_DATE)",
      [ulid(), siteId, usuarioId, dados.nome.trim()],
    );
    await c.query('INSERT INTO usuario_perfis (usuario_id, site_id, perfil_id) VALUES (?, ?, ?)', [
      usuarioId,
      siteId,
      PERFIL_ADMIN_ID,
    ]);
    return { usuarioId, siteId, siteCriado, login };
  });

  esquecerSiteAtual();
  return resultado;
}

export async function existeEstacionamento(): Promise<boolean> {
  const [linhas] = await pool.query<RowDataPacket[]>('SELECT 1 FROM sites WHERE ativo = TRUE LIMIT 1');
  return linhas.length > 0;
}
