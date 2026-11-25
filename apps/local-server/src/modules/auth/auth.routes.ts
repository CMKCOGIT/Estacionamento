import { Router } from 'express';
import { z } from 'zod';
import { POLITICA_SENHA, type RespostaSessao } from '@estacionamento/shared';
import {
  COOKIE_SESSAO,
  definirCookieSessao,
  exigirAutenticacao,
  limparCookieSessao,
  metaDaRequisicao,
} from '../../http/middlewares/autenticacao.js';
import { carregarConfig } from '../configuracoes/preferencias.js';
import { authService, regrasSenhaAtuais } from './auth.service.js';

export const authRouter = Router();

const corpoLogin = z.object({
  login: z.string().trim().min(1, 'Informe o usuário').max(60),
  senha: z.string().min(1, 'Informe a senha').max(POLITICA_SENHA.maximo),
});

const corpoTrocaSenha = z.object({
  senhaAtual: z.string().min(1, 'Informe a senha atual').max(POLITICA_SENHA.maximo),
  novaSenha: z.string().min(1, 'Informe a nova senha').max(POLITICA_SENHA.maximo),
});

const autenticado = exigirAutenticacao({ permitirTrocaDeSenhaPendente: true });

/** POST /auth/login — público. Define o cookie de sessão. */
authRouter.post('/login', async (req, res) => {
  const dados = corpoLogin.parse(req.body);
  const { token, resposta } = await authService.login(dados, metaDaRequisicao(req));
  definirCookieSessao(res, token);
  res.json(resposta);
});

/** POST /auth/logout — sempre limpa o cookie, mesmo se a sessão já tiver expirado. */
authRouter.post('/logout', async (req, res) => {
  const token: unknown = req.cookies?.[COOKIE_SESSAO];
  if (typeof token === 'string' && token) {
    const auth = await authService.autenticar(token).catch(() => null); // já inválida: nada a encerrar
    if (auth) await authService.logout(auth, metaDaRequisicao(req));
  }
  limparCookieSessao(res);
  res.status(204).end();
});

/** GET /auth/sessao — quem está logado (o painel chama ao abrir). */
authRouter.get('/sessao', autenticado, async (req, res) => {
  const { sessaoId: _s, temPermissao: _t, expiraEm, ...usuario } = req.auth!;
  const { seguranca } = await carregarConfig();
  res.json({
    usuario,
    expiraEm: expiraEm.toISOString(),
    inatividadeMinutos: seguranca.inatividadeMin,
    regrasSenha: await regrasSenhaAtuais(),
  } satisfies RespostaSessao);
});

/** POST /auth/trocar-senha — encerra as outras sessões do usuário. */
authRouter.post('/trocar-senha', autenticado, async (req, res) => {
  const dados = corpoTrocaSenha.parse(req.body);
  await authService.trocarSenha(req.auth!, dados, metaDaRequisicao(req));
  res.status(204).end();
});
