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

  get codigo() {
    return this.corpo.codigo;
  }
}

const BASE = '/api/v1';

/**
 * Eventos globais disparados quando a API indica que a sessão acabou ou que a
 * senha precisa ser trocada. O AuthProvider escuta e redireciona.
 */
export const EVENTO_SESSAO_ENCERRADA = 'auth:sessao-encerrada';
export const EVENTO_TROCA_SENHA = 'auth:troca-senha-obrigatoria';

interface OpcoesApi extends Omit<RequestInit, 'body'> {
  corpo?: unknown;
  /** Não dispara o redirecionamento global em 401 (usado no próprio login). */
  ignorarSessao?: boolean;
}

/**
 * Cliente HTTP único do painel. Envia o cookie de sessão (mesma origem),
 * converte qualquer falha em `ErroDaApi` e avisa o app quando a sessão expira.
 */
export async function api<T>(caminho: string, opcoes: OpcoesApi = {}): Promise<T> {
  const { corpo, ignorarSessao, headers, ...init } = opcoes;
  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}${caminho}`, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ErroDaApi(0, {
      codigo: 'ERRO_INTERNO',
      mensagem: 'Servidor local inacessível. Ele está ligado?',
    });
  }

  if (resposta.status === 204) return undefined as T;
  const dados: unknown = await resposta.json().catch(() => null);

  if (!resposta.ok) {
    const erro = new ErroDaApi(
      resposta.status,
      (dados as ErroApi | null)?.erro ?? { codigo: 'ERRO_INTERNO', mensagem: `Erro HTTP ${resposta.status}` },
    );
    if (!ignorarSessao && resposta.status === 401) {
      window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_ENCERRADA, { detail: erro.message }));
    }
    if (erro.codigo === 'TROCA_SENHA_OBRIGATORIA') window.dispatchEvent(new CustomEvent(EVENTO_TROCA_SENHA));
    throw erro;
  }
  return dados as T;
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
