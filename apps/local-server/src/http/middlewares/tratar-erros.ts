import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ErroCalculo } from '@estacionamento/calculo';
import type { ErroApi } from '@estacionamento/shared';
import { emProducao } from '../../config/env.js';
import { AppError } from '../erros.js';
import { traduzirErroMysql } from '../erros-mysql.js';

/** 404 para qualquer rota /api inexistente. */
export const rotaNaoEncontrada: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'ROTA_NAO_ENCONTRADA', `Rota não encontrada: ${req.method} ${req.originalUrl}`));
};

function normalizarErro(erro: unknown): AppError {
  if (erro instanceof AppError) return erro;
  // Regra do motor de cálculo (ex.: desconto maior que o valor, tarifa sem diária)
  if (erro instanceof ErroCalculo)
    return new AppError(422, 'REGRA_DE_NEGOCIO', erro.message, { motivo: erro.codigo });

  if (erro instanceof ZodError) {
    return new AppError(
      400,
      'REQUISICAO_INVALIDA',
      'Dados da requisição inválidos',
      erro.issues.map((i) => ({ campo: i.path.join('.') || '(corpo)', mensagem: i.message })),
    );
  }

  // Erros do body-parser do Express (express.json)
  const tipo = (erro as { type?: string } | null)?.type;
  if (tipo === 'entity.parse.failed') return new AppError(400, 'JSON_INVALIDO', 'JSON malformado no corpo');
  if (tipo === 'entity.too.large')
    return new AppError(413, 'CORPO_MUITO_GRANDE', 'Corpo da requisição muito grande');

  const doBanco = traduzirErroMysql(erro);
  if (doBanco) return doBanco;

  return new AppError(
    500,
    'ERRO_INTERNO',
    emProducao ? 'Erro interno no servidor' : `Erro interno: ${(erro as Error)?.message ?? String(erro)}`,
  );
}

/**
 * Tratamento centralizado de erros. Express 5 já encaminha para cá as exceções
 * de handlers async, então os módulos só precisam lançar (`throw`).
 * Resposta sempre no formato `ErroApi` (packages/shared).
 */
export const tratarErros: ErrorRequestHandler = (erro, req, res, next) => {
  if (res.headersSent) {
    next(erro);
    return;
  }

  const appErro = normalizarErro(erro);

  if (appErro.status >= 500) req.log.error({ err: erro }, appErro.message);
  else req.log.warn({ codigo: appErro.codigo, status: appErro.status }, appErro.message);

  const corpo: ErroApi = {
    erro: {
      codigo: appErro.codigo,
      mensagem: appErro.message,
      ...(appErro.detalhes && { detalhes: appErro.detalhes }),
      requestId: String(req.id),
    },
  };
  res.status(appErro.status).json(corpo);
};
