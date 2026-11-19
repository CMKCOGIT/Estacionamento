import { createHash, randomBytes } from 'node:crypto';
import { ulid } from 'ulid';
import {
  problemasDaSenha,
  type RequisicaoLogin,
  type RequisicaoTrocaSenha,
  type RespostaSessao,
  type UsuarioAutenticado,
} from '@estacionamento/shared';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { obterSiteAtual } from '../../config/site.js';
import { registrarAtividade } from '../../db/atividades.js';
import { comTransacao } from '../../db/transacao.js';
import { AppError } from '../../http/erros.js';
import { authRepository as repo } from './auth.repository.js';
import { LimitadorDeTentativas } from './limitador.js';
import { conferirSenha, gastarTempoDeVerificacao, gerarHashSenha } from './senha.js';

/** Dados da requisição usados para auditoria e limites. */
export interface MetaRequisicao {
  ip: string | null;
  userAgent: string | null;
  correlacaoId: string | null;
}

/** Usuário autenticado + sessão, anexado em `req.auth` pelo middleware. */
export interface Autenticacao extends UsuarioAutenticado {
  sessaoId: string;
  expiraEm: Date;
  temPermissao(codigo: string): boolean;
}

const JANELA_LIMITE_IP_MS = 15 * 60 * 1000;
export const limitadorPorIp = new LimitadorDeTentativas(env.LOGIN_LIMITE_POR_IP, JANELA_LIMITE_IP_MS);

const MSG_CREDENCIAIS = 'Usuário ou senha inválidos.';

export function hashDoToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function minutos(segundos: number): string {
  const m = Math.max(1, Math.ceil(segundos / 60));
  return `${m} minuto${m > 1 ? 's' : ''}`;
}

export function normalizarLogin(login: string): string {
  return login.trim().toLowerCase();
}

type ResultadoLogin =
  | { tipo: 'ok'; token: string; sessaoId: string; expiraEm: Date; usuarioId: string }
  | { tipo: 'falha'; usuarioId: string | null; motivo: string }
  | { tipo: 'bloqueado'; usuarioId: string; segundos: number; acabouDeBloquear: boolean }
  | { tipo: 'sem_acesso'; usuarioId: string };

export const authService = {
  async login(
    dados: RequisicaoLogin,
    meta: MetaRequisicao,
  ): Promise<{ token: string; resposta: RespostaSessao }> {
    const chaveIp = meta.ip ?? 'desconhecido';
    const espera = limitadorPorIp.segundosParaLiberar(chaveIp);
    if (espera > 0) {
      throw new AppError(
        429,
        'MUITAS_TENTATIVAS',
        `Muitas tentativas de login a partir deste computador. Aguarde ${minutos(espera)} e tente novamente.`,
        { segundosParaTentarDeNovo: espera },
      );
    }

    const login = normalizarLogin(dados.login);
    const site = await obterSiteAtual();

    const resultado = await comTransacao<ResultadoLogin>({ correlacaoId: meta.correlacaoId }, async (c) => {
      const u = await repo.buscarUsuarioParaLogin(c, login);
      if (!u) {
        await gastarTempoDeVerificacao(dados.senha);
        return { tipo: 'falha', usuarioId: null, motivo: 'login_inexistente' };
      }

      if (u.bloqueado) {
        return {
          tipo: 'bloqueado',
          usuarioId: u.id,
          segundos: u.segundosDeBloqueio,
          acabouDeBloquear: false,
        };
      }

      const senhaOk = await conferirSenha(u.senhaHash, dados.senha);
      if (!senhaOk) {
        // Bloqueio anterior já venceu: a contagem recomeça.
        const tentativas = (u.bloqueioExpirado ? 0 : u.tentativasFalhas) + 1;
        if (tentativas >= env.LOGIN_MAX_TENTATIVAS) {
          await repo.registrarFalha(c, u.id, tentativas, env.LOGIN_BLOQUEIO_MIN);
          return {
            tipo: 'bloqueado',
            usuarioId: u.id,
            segundos: env.LOGIN_BLOQUEIO_MIN * 60,
            acabouDeBloquear: true,
          };
        }
        await repo.registrarFalha(c, u.id, tentativas, null);
        return { tipo: 'falha', usuarioId: u.id, motivo: 'senha_incorreta' };
      }

      // Senha correta, mas conta desativada: mesma resposta genérica.
      if (!u.ativo) return { tipo: 'falha', usuarioId: u.id, motivo: 'usuario_inativo' };

      const perfis = await repo.perfisDoUsuario(u.id, site.id, c);
      if (perfis.length === 0) return { tipo: 'sem_acesso', usuarioId: u.id };

      await repo.registrarSucesso(c, u.id);
      const token = randomBytes(32).toString('base64url');
      const sessaoId = ulid();
      const expiraEm = await repo.criarSessao(c, {
        id: sessaoId,
        usuarioId: u.id,
        siteId: site.id,
        tokenHash: hashDoToken(token),
        duracaoHoras: env.SESSAO_DURACAO_MAX_HORAS,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { tipo: 'ok', token, sessaoId, expiraEm, usuarioId: u.id };
    });

    const base = { siteId: site.id, ip: meta.ip, correlacaoId: meta.correlacaoId };

    switch (resultado.tipo) {
      case 'ok': {
        limitadorPorIp.limpar(chaveIp);
        await registrarAtividade({
          ...base,
          acao: 'auth.login',
          usuarioId: resultado.usuarioId,
          entidade: 'sessoes_acesso',
          entidadeId: resultado.sessaoId,
          dados: { userAgent: meta.userAgent },
        });
        const usuario = await this.montarUsuario(resultado.usuarioId, site.id);
        return {
          token: resultado.token,
          resposta: {
            usuario,
            expiraEm: resultado.expiraEm.toISOString(),
            inatividadeMinutos: env.SESSAO_INATIVIDADE_MIN,
          },
        };
      }

      case 'falha':
        limitadorPorIp.registrarFalha(chaveIp);
        await registrarAtividade({
          ...base,
          acao: 'auth.login_falhou',
          usuarioId: resultado.usuarioId,
          dados: { login, motivo: resultado.motivo },
        });
        throw new AppError(401, 'CREDENCIAIS_INVALIDAS', MSG_CREDENCIAIS);

      case 'bloqueado':
        if (resultado.acabouDeBloquear) limitadorPorIp.registrarFalha(chaveIp);
        await registrarAtividade({
          ...base,
          acao: resultado.acabouDeBloquear ? 'auth.login_falhou' : 'auth.login_recusado_bloqueio',
          usuarioId: resultado.usuarioId,
          dados: { login, motivo: resultado.acabouDeBloquear ? 'conta_bloqueada_agora' : 'conta_bloqueada' },
        });
        throw new AppError(
          423,
          'CONTA_BLOQUEADA',
          `Conta bloqueada temporariamente por excesso de tentativas. Tente novamente em ${minutos(resultado.segundos)} ` +
            'ou peça a um administrador para desbloquear.',
          { segundosParaTentarDeNovo: resultado.segundos },
        );

      case 'sem_acesso':
        await registrarAtividade({
          ...base,
          acao: 'auth.login_falhou',
          usuarioId: resultado.usuarioId,
          dados: { login, motivo: 'sem_perfil_no_site' },
        });
        throw new AppError(
          403,
          'SEM_PERMISSAO',
          'Seu usuário não tem acesso a este estacionamento. Fale com o administrador.',
        );
    }
  },

  /** Monta o usuário com perfis e permissões (resposta de login e de /sessao). */
  async montarUsuario(
    usuarioId: string,
    siteId: string,
    base?: { login: string; nome: string; deveTrocarSenha: boolean },
  ) {
    const [perfis, permissoes] = await Promise.all([
      repo.perfisDoUsuario(usuarioId, siteId),
      repo.permissoesDoUsuario(usuarioId, siteId),
    ]);
    const dados = base ?? (await repo.dadosBasicosUsuario(usuarioId));
    if (!dados) throw new AppError(401, 'SESSAO_EXPIRADA', 'Usuário não encontrado. Entre novamente.');
    return { id: usuarioId, siteId, perfis, permissoes, ...dados } satisfies UsuarioAutenticado;
  },

  /**
   * Valida o token do cookie. Encerra no banco sessões vencidas/inválidas e
   * lança 401 SESSAO_EXPIRADA. Retorna a autenticação completa.
   */
  async autenticar(token: string): Promise<Autenticacao> {
    const s = await repo.buscarSessaoPorToken(hashDoToken(token), env.SESSAO_INATIVIDADE_MIN);
    const expirada = (msg: string) => new AppError(401, 'SESSAO_EXPIRADA', msg);

    if (!s || s.encerrada) throw expirada('Sua sessão foi encerrada. Entre novamente.');
    if (s.expirou) {
      await repo.encerrarSessao(s.id, 'EXPIRADA');
      throw expirada('Sua sessão expirou. Entre novamente.');
    }
    if (s.inativa) {
      await repo.encerrarSessao(s.id, 'INATIVIDADE');
      throw expirada('Sua sessão expirou por inatividade. Entre novamente.');
    }
    if (!s.usuarioAtivo) {
      await repo.encerrarSessao(s.id, 'USUARIO_DESATIVADO');
      throw expirada('Seu usuário foi desativado. Fale com o administrador.');
    }

    const usuario = await this.montarUsuario(s.usuarioId, s.siteId, {
      login: s.login,
      nome: s.nome,
      deveTrocarSenha: s.deveTrocarSenha,
    });
    if (usuario.perfis.length === 0) {
      await repo.encerrarSessao(s.id, 'REVOGADA');
      throw expirada('Seu acesso a este estacionamento foi removido. Fale com o administrador.');
    }

    // Atualiza "último uso" no máximo 1x por minuto (evita uma escrita por requisição).
    if (s.segundosDesdeUso >= 60) {
      repo
        .tocarSessao(s.id)
        .catch((e: unknown) => logger.warn({ err: e }, 'Falha ao atualizar uso da sessão'));
    }

    const permissoes = new Set(usuario.permissoes);
    return { ...usuario, sessaoId: s.id, expiraEm: s.expiraEm, temPermissao: (p) => permissoes.has(p) };
  },

  async logout(auth: Pick<Autenticacao, 'sessaoId' | 'id' | 'siteId'>, meta: MetaRequisicao): Promise<void> {
    await repo.encerrarSessao(auth.sessaoId, 'LOGOUT');
    await registrarAtividade({
      acao: 'auth.logout',
      siteId: auth.siteId,
      usuarioId: auth.id,
      entidade: 'sessoes_acesso',
      entidadeId: auth.sessaoId,
      ip: meta.ip,
      correlacaoId: meta.correlacaoId,
    });
  },

  /** Troca a própria senha. Encerra as OUTRAS sessões do usuário. */
  async trocarSenha(auth: Autenticacao, dados: RequisicaoTrocaSenha, meta: MetaRequisicao): Promise<void> {
    const problemas = problemasDaSenha(dados.novaSenha, auth.login);
    if (dados.novaSenha === dados.senhaAtual) problemas.push('A nova senha deve ser diferente da atual');
    if (problemas.length) {
      throw new AppError(
        400,
        'REQUISICAO_INVALIDA',
        'A nova senha não atende às regras',
        problemas.map((mensagem) => ({ campo: 'novaSenha', mensagem })),
      );
    }

    const novoHash = await gerarHashSenha(dados.novaSenha);
    await comTransacao(
      { usuarioId: auth.id, correlacaoId: meta.correlacaoId, motivo: 'troca de senha' },
      async (c) => {
        const atual = await repo.buscarHashSenha(c, auth.id);
        // 422 (e não 401): senha atual errada não deve derrubar a sessão no painel.
        if (!atual || !(await conferirSenha(atual, dados.senhaAtual))) {
          throw new AppError(422, 'CREDENCIAIS_INVALIDAS', 'Senha atual incorreta.');
        }
        await repo.atualizarSenha(c, auth.id, novoHash);
        await repo.encerrarOutrasSessoes(c, auth.id, 'SENHA_ALTERADA', auth.sessaoId);
      },
    );
  },

  encerrarSessoesVencidas(): Promise<number> {
    return repo.encerrarSessoesVencidas(env.SESSAO_INATIVIDADE_MIN);
  },
};
