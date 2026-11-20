import type { TicketPublico } from '@estacionamento/shared';

/**
 * Tickets guardados NESTE celular (localStorage). Cada um só é consultado
 * pelo próprio token — o app não tem como listar ou buscar outros tickets.
 */
export interface TicketSalvo {
  token: string;
  salvoEm: string;
  /** Última resposta da API (mostrada sem internet, com o horário). */
  ultimo: TicketPublico | null;
  ultimoEm: string | null;
}

const CHAVE = 'meu-ticket:tickets';
const MAXIMO = 5;

/** localStorage pode não existir (modo privado, bloqueado): o app continua funcionando, só não lembra. */
function armazenamento(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function lerTickets(): TicketSalvo[] {
  try {
    const bruto = armazenamento()?.getItem(CHAVE);
    const lista = bruto ? (JSON.parse(bruto) as TicketSalvo[]) : [];
    return Array.isArray(lista) ? lista.filter((t) => typeof t?.token === 'string') : [];
  } catch {
    return [];
  }
}

function gravar(lista: TicketSalvo[]) {
  try {
    armazenamento()?.setItem(CHAVE, JSON.stringify(lista));
  } catch {
    // cheio ou bloqueado: segue sem guardar
  }
}

/** Guarda (ou move para o topo) o ticket do link. Mantém no máximo 5. */
export function salvarToken(token: string, agora = new Date()): TicketSalvo[] {
  const atual = lerTickets();
  const existente = atual.find((t) => t.token === token);
  const lista = [
    existente ?? { token, salvoEm: agora.toISOString(), ultimo: null, ultimoEm: null },
    ...atual.filter((t) => t.token !== token),
  ].slice(0, MAXIMO);
  gravar(lista);
  return lista;
}

export function atualizarUltimo(token: string, ticket: TicketPublico, agora = new Date()) {
  gravar(
    lerTickets().map((t) =>
      t.token === token ? { ...t, ultimo: ticket, ultimoEm: agora.toISOString() } : t,
    ),
  );
}

/**
 * O acesso terminou (a API não reconhece mais o link): apaga do celular a
 * placa, a vaga e os valores, mantendo só o aviso de "acesso encerrado".
 */
export function apagarDadosPessoais(token: string) {
  gravar(
    lerTickets().map((t) =>
      t.token === token && t.ultimo
        ? {
            ...t,
            ultimo: {
              ...t.ultimo,
              placa: '',
              vaga: null,
              itens: [],
              valorCentavos: 0,
              pagoCentavos: 0,
              aPagarCentavos: 0,
              proximaCobranca: null,
            },
          }
        : t,
    ),
  );
}

/**
 * Política de encerramento: tickets cujo acesso já terminou saem do celular
 * (a placa é dado pessoal). Devolve a lista restante e quantos saíram.
 */
export function removerEncerrados(agora = Date.now()): { lista: TicketSalvo[]; removidos: number } {
  const atual = lerTickets();
  const lista = atual.filter((t) => {
    const expira = t.ultimo?.acessoExpiraEm;
    return !(expira && Date.parse(expira) <= agora);
  });
  if (lista.length !== atual.length) gravar(lista);
  return { lista, removidos: atual.length - lista.length };
}

export function esquecer(token: string): TicketSalvo[] {
  const lista = lerTickets().filter((t) => t.token !== token);
  gravar(lista);
  return lista;
}

const CHAVE_SITE = 'meu-ticket:estacionamento';
export const lerSite = (): string | null => {
  try {
    return armazenamento()?.getItem(CHAVE_SITE) ?? null;
  } catch {
    return null;
  }
};
export const gravarSite = (slug: string) => {
  try {
    armazenamento()?.setItem(CHAVE_SITE, slug);
  } catch {
    // sem armazenamento
  }
};
