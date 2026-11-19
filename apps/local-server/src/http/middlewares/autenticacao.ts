import type { Request, RequestHandler, Response } from 'express';
import { env } from '../../config/env.js';
import type { ContextoAuditoria } from '../../db/transacao.js';
import { authService, type Autenticacao, type MetaRequisicao } from '../../modules/auth/auth.service.js';
import { AppError, erros } from '../erros.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Preenchido por `exigirAutenticacao`. */
      auth?: Autenticacao;
    }
  }
}

export const COOKIE_SESSAO = 'est_sessao';

export function definirCookieSessao(res: Response, token: string): void {
  res.cookie(COOKIE_SESSAO, token, {
    httpOnly: true, // JavaScript da página não consegue ler o token
    sameSite: 'strict', // não é enviado por sites de terceiros (proteção CSRF)
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: env.SESSAO_DURACAO_MAX_HORAS * 60 * 60 * 1000,
  });
}

export function limparCookieSessao(res: Response): void {
  res.clearCookie(COOKIE_SESSAO, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.COOKIE_SECURE,
    path: '/',
  });
}

export function metaDaRequisicao(req: Request): MetaRequisicao {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
    correlacaoId: String(req.id),
  };
}

/** Contexto para `comTransacao`: os triggers gravam quem fez cada alteração. */
export function contextoAuditoria(req: Request, motivo?: string | null): ContextoAuditoria {
  return { usuarioId: req.auth?.id ?? null, motivo: motivo ?? null, correlacaoId: String(req.id) };
}

interface OpcoesAutenticacao {
  /** Permite acesso mesmo com troca de senha pendente (rotas de /auth). */
  permitirTrocaDeSenhaPendente?: boolean;
}

/** Exige sessão válida. Sem ela: 401. Com troca de senha obrigatória: 403. */
export function exigirAutenticacao(opcoes: OpcoesAutenticacao = {}): RequestHandler {
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[COOKIE_SESSAO];
    if (typeof token !== 'string' || token.length === 0) {
      next(erros.naoAutenticado('Faça login para continuar.'));
      return;
    }
    try {
      req.auth = await authService.autenticar(token);
    } catch (erro) {
      if (erro instanceof AppError && erro.status === 401) limparCookieSessao(res);
      throw erro;
    }
    if (req.auth.deveTrocarSenha && !opcoes.permitirTrocaDeSenhaPendente) {
      throw new AppError(403, 'TROCA_SENHA_OBRIGATORIA', 'Troque sua senha para continuar.');
    }
    next();
  };
}

/**
 * Exige UMA das permissões informadas (ex.: exigirPermissao('tarifa.publicar')).
 * Deve vir depois de `exigirAutenticacao`.
 */
export function exigirPermissao(...permissoes: [string, ...string[]]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw erros.naoAutenticado();
    if (!permissoes.some((p) => req.auth?.temPermissao(p))) {
      throw new AppError(403, 'SEM_PERMISSAO', 'Você não tem permissão para esta ação.', {
        necessaria: permissoes,
      });
    }
    next();
  };
}
