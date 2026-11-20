import type {
  DisponibilidadePublica,
  ErroPublico,
  TarifasPublicas,
  TicketPublico,
} from '@estacionamento/shared';
import { API_URL } from './config';

export type FalhaApi =
  'NAO_ENCONTRADO' | 'SEM_CONEXAO' | 'TEMPO_ESGOTADO' | 'MUITAS_TENTATIVAS' | 'INDISPONIVEL';

/** Uma consulta que não responde em 10 s é tratada como falha (não fica "carregando" para sempre). */
export const TEMPO_LIMITE_MS = 10_000;

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
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  try {
    r = await fetch(`${API_URL}/v1${caminho}`, {
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Ticket ${token}` } : {}) },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controle.signal,
    });
    if (r.ok) return (await r.json()) as T;
  } catch {
    if (controle.signal.aborted)
      throw new ErroApi('TEMPO_ESGOTADO', 'O serviço demorou demais para responder.');
    // Sem rede no celular, ou o servidor externo não respondeu
    throw navigator.onLine === false
      ? new ErroApi('SEM_CONEXAO', 'Sem conexão com a internet.')
      : new ErroApi('INDISPONIVEL', 'Não foi possível falar com o serviço do estacionamento.');
  } finally {
    clearTimeout(limite);
  }
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
