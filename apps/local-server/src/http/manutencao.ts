import type { RequestHandler } from 'express';
import { AppError } from './erros.js';

/**
 * Modo manutenção: durante a restauração de um backup pelo painel, a API
 * responde 503 para tudo (menos /health), para ninguém gravar no banco que
 * está sendo substituído.
 */
let motivo: string | null = null;

export const manutencao = {
  ativar(m: string) {
    motivo = m;
  },
  desativar() {
    motivo = null;
  },
  ativa: () => motivo !== null,
};

export const bloquearEmManutencao: RequestHandler = (req, _res, next) => {
  if (motivo && !req.path.startsWith('/v1/health')) {
    throw new AppError(503, 'EM_MANUTENCAO', `${motivo} Aguarde alguns minutos e recarregue a página.`);
  }
  next();
};
