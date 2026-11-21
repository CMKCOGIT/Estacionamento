import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Estado da requisição em andamento, visível em qualquer ponto do código
 * chamado por ela. Hoje: se a tela já recebeu "não respondeu a tempo" (503),
 * nada mais pode ser gravado por essa requisição — senão o operador veria um
 * erro e a operação aconteceria mesmo assim, minutos depois.
 */
export interface EstadoRequisicao {
  expirada: boolean;
}

export const contextoRequisicao = new AsyncLocalStorage<EstadoRequisicao>();

export const requisicaoExpirada = () => contextoRequisicao.getStore()?.expirada === true;
