import type { ErroPublico } from '@estacionamento/shared';

export class ErroApiPublica extends Error {
  constructor(
    readonly status: number,
    readonly codigo: ErroPublico['erro']['codigo'],
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/**
 * Mesma resposta para token inexistente, revogado ou expirado: quem tenta
 * adivinhar links não descobre se acertou "quase".
 */
export const ticketNaoEncontrado = () =>
  new ErroApiPublica(
    404,
    'NAO_ENCONTRADO',
    'Ticket não encontrado ou acesso expirado. Confira o link ou peça um novo QR Code no caixa.',
  );
