import type {
  DisponibilidadePublica,
  ErroPublico,
  TarifasPublicas,
  TicketPublico,
} from '@estacionamento/shared';
import { API_URL } from './config';

export type FalhaApi = 'NAO_ENCONTRADO' | 'SEM_CONEXAO' | 'MUITAS_TENTATIVAS' | 'INDISPONIVEL';

export class ErroApi extends Error {
  constructor(
    readonly tipo: FalhaApi,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Só a API pública (somente leitura). O app não conhece nenhum endereço administrativo. */
async function obter<T>(caminho: string, token?: string): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${API_URL}/v1${caminho}`, {
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Ticket ${token}` } : {}) },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  } catch {
    throw new ErroApi('SEM_CONEXAO', 'Sem conexão com a internet.');
  }
  if (r.ok) return (await r.json()) as T;
  const corpo = (await r.json().catch(() => null)) as ErroPublico | null;
  const tipo: FalhaApi =
    r.status === 404 ? 'NAO_ENCONTRADO' : r.status === 429 ? 'MUITAS_TENTATIVAS' : 'INDISPONIVEL';
  throw new ErroApi(tipo, corpo?.erro.mensagem ?? 'Serviço indisponível no momento.');
}

export const api = {
  ticket: (token: string) => obter<TicketPublico>('/ticket', token),
  disponibilidade: (slug: string) =>
    obter<DisponibilidadePublica>(`/sites/${encodeURIComponent(slug)}/disponibilidade`),
  tarifas: (slug: string) => obter<TarifasPublicas>(`/sites/${encodeURIComponent(slug)}/tarifas`),
};
