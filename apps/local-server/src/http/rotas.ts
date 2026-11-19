import { Router } from 'express';
import { modulos } from '../modules/index.js';
import { rotaNaoEncontrada } from './middlewares/tratar-erros.js';

/** Monta todas as rotas versionadas em /api/v1. */
export function criarRotasApi(): Router {
  const api = Router();
  for (const { caminho, router } of modulos) api.use(caminho, router);
  api.use(rotaNaoEncontrada);
  return api;
}
