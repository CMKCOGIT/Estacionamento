import type { ErroApi } from '@estacionamento/shared';

/** Erro de API já no formato padrão do backend. */
export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    readonly corpo: ErroApi['erro'],
  ) {
    super(corpo.mensagem);
    this.name = 'ErroDaApi';
  }
}

const BASE = '/api/v1';

/**
 * Cliente HTTP único do painel. Converte qualquer falha em `ErroDaApi`,
 * para que as telas tratem erros sempre do mesmo jeito.
 */
export async function api<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}${caminho}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ErroDaApi(0, {
      codigo: 'ERRO_INTERNO',
      mensagem: 'Servidor local inacessível. Ele está ligado?',
    });
  }

  const corpo: unknown = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const erro = (corpo as ErroApi | null)?.erro;
    throw new ErroDaApi(
      resposta.status,
      erro ?? { codigo: 'ERRO_INTERNO', mensagem: `Erro HTTP ${resposta.status}` },
    );
  }
  return corpo as T;
}

/** Variante para endpoints que respondem com corpo útil mesmo em erro (ex.: /health → 503). */
export async function apiComStatus<T>(caminho: string): Promise<{ status: number; corpo: T | null }> {
  try {
    const resposta = await fetch(`${BASE}${caminho}`, { headers: { Accept: 'application/json' } });
    return { status: resposta.status, corpo: (await resposta.json().catch(() => null)) as T | null };
  } catch {
    return { status: 0, corpo: null };
  }
}
