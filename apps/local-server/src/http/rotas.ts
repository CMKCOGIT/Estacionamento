import { Router } from 'express';
import { modulos } from '../modules/index.js';
import { exigirAutenticacao } from './middlewares/autenticacao.js';
import { rotaNaoEncontrada } from './middlewares/tratar-erros.js';

/** Monta todas as rotas versionadas em /api/v1. Módulos não públicos exigem login. */
export function criarRotasApi(): Router {
  const api = Router();
  const autenticar = exigirAutenticacao();
  for (const { caminho, router, publico } of modulos) {
    if (publico) api.use(caminho, router);
    else api.use(caminho, autenticar, router);
  }
  api.use(rotaNaoEncontrada);
  return api;
}
