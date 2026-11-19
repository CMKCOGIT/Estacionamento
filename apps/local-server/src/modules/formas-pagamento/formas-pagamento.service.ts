import type { FormaPagamento } from '@estacionamento/shared';
import { erros } from '../../http/erros.js';
import { formasPagamentoRepository } from './formas-pagamento.repository.js';

/** Regras de negócio do módulo. Não conhece HTTP nem SQL. */
export const formasPagamentoService = {
  listar(somenteAtivas: boolean): Promise<FormaPagamento[]> {
    return formasPagamentoRepository.listar({ somenteAtivas });
  },

  async obter(codigo: string): Promise<FormaPagamento> {
    const forma = await formasPagamentoRepository.buscarPorCodigo(codigo);
    if (!forma) throw erros.naoEncontrado(`Forma de pagamento "${codigo}" não encontrada`);
    return forma;
  },
};
