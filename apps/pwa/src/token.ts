import { PADRAO_TOKEN_TICKET } from '@estacionamento/shared';

/**
 * Lê o token do link do ticket (`/t#<token>`). O token fica depois do `#`,
 * então nunca é enviado a servidor nenhum ao abrir o link.
 */
export function tokenDoLink(hash: string): string | null {
  const t = decodeURIComponent(hash.replace(/^#/, '')).trim();
  return PADRAO_TOKEN_TICKET.test(t) ? t : null;
}
