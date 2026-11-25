import type { Request, RequestHandler, Response } from 'express';
import { env } from '../../config/env.js';
import { registrarAtividade } from '../../db/atividades.js';
import type { ContextoAuditoria } from '../../db/transacao.js';
import { configEmCache } from '../../modules/configuracoes/preferencias.js';
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
    maxAge: configEmCache().seguranca.duracaoMaxHoras * 60 * 60 * 1000,
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
/**
 * Tentativas de acesso sem permissão vão para o histórico (auditoria). Uma
 * por usuário e rota a cada 10 min, para a tela que tenta de novo sozinha
 * não encher o histórico.
 */
const negadosRecentes = new Map<string, number>();
function registrarAcessoNegado(req: Request, permissoes: string[]) {
  const auth = req.auth!;
  const rota = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;
  const chave = `${auth.id}|${rota}`;
  const agora = Date.now();
  if ((negadosRecentes.get(chave) ?? 0) > agora - 10 * 60_000) return;
  negadosRecentes.set(chave, agora);
  if (negadosRecentes.size > 5000) negadosRecentes.clear();
  registrarAtividade({
    acao: 'acesso.negado',
    siteId: auth.siteId,
    usuarioId: auth.id,
    dados: { rota, necessaria: permissoes },
    ip: metaDaRequisicao(req).ip,
  }).catch(() => undefined);
}

export function exigirPermissao(...permissoes: [string, ...string[]]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw erros.naoAutenticado();
    if (!permissoes.some((p) => req.auth?.temPermissao(p))) {
      registrarAcessoNegado(req, permissoes);
      throw new AppError(403, 'SEM_PERMISSAO', 'Você não tem permissão para esta ação.', {
        necessaria: permissoes,
      });
    }
    next();
  };
}
