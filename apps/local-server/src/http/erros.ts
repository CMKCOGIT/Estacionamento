import type { CodigoErro, ErroApi } from '@estacionamento/shared';

type Detalhes = NonNullable<ErroApi['erro']['detalhes']>;

/**
 * Erro "esperado" da aplicação: já carrega status HTTP, código e mensagem
 * segura para mostrar ao usuário. Qualquer outro erro vira 500.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly codigo: CodigoErro,
    mensagem: string,
    readonly detalhes?: Detalhes,
  ) {
    super(mensagem);
    this.name = 'AppError';
  }
}

/** Atalhos para os erros mais comuns nos módulos. */
export const erros = {
  requisicaoInvalida: (mensagem: string, detalhes?: Detalhes) =>
    new AppError(400, 'REQUISICAO_INVALIDA', mensagem, detalhes),
  naoAutenticado: (mensagem = 'Faça login para continuar') => new AppError(401, 'NAO_AUTENTICADO', mensagem),
  semPermissao: (mensagem = 'Você não tem permissão para esta ação') =>
    new AppError(403, 'SEM_PERMISSAO', mensagem),
  naoEncontrado: (mensagem = 'Registro não encontrado') => new AppError(404, 'NAO_ENCONTRADO', mensagem),
  conflito: (mensagem: string) => new AppError(409, 'CONFLITO', mensagem),
  regraDeNegocio: (mensagem: string, detalhes?: Detalhes) =>
    new AppError(422, 'REGRA_DE_NEGOCIO', mensagem, detalhes),
};
