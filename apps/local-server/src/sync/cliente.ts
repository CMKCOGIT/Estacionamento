import { createHash, createHmac, randomBytes } from 'node:crypto';
import { CABECALHOS_INTEGRACAO as H, textoParaAssinar } from '@estacionamento/shared';

export interface CredencialSync {
  url: string;
  integracaoId: string;
  segredo: string;
}

export interface RespostaNuvem<T> {
  status: number;
  corpo: T | null;
  /** Mensagem de erro da API (quando houver). */
  erro: string | null;
  /** X-Request-Id da nuvem: o mesmo id aparece no registro de lá (rastreio entre os dois bancos). */
  requisicaoId: string | null;
}

/** Falha de rede/tempo: nada chegou do outro lado (tenta de novo depois). */
export class FalhaDeRede extends Error {}

const TEMPO_LIMITE_MS = 20_000;

/**
 * Chamada assinada à API externa (ARQUITETURA §7.2): HMAC-SHA256 sobre
 * horário, nonce, método, rota e hash do corpo. HTTPS em produção (env.ts).
 */
export async function chamarNuvem<T>(
  cred: CredencialSync,
  metodo: 'GET' | 'POST',
  rota: string,
  corpo?: unknown,
): Promise<RespostaNuvem<T>> {
  const bruto = corpo === undefined ? '' : JSON.stringify(corpo);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString('hex');
  const assinatura = createHmac('sha256', cred.segredo)
    .update(
      textoParaAssinar({
        timestamp,
        nonce,
        metodo,
        rota,
        sha256Corpo: createHash('sha256').update(bruto).digest('hex'),
      }),
    )
    .digest('hex');
  let r: Response;
  try {
    r = await fetch(`${cred.url.replace(/\/+$/, '')}${rota}`, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [H.id]: cred.integracaoId,
        [H.timestamp]: timestamp,
        [H.nonce]: nonce,
        [H.assinatura]: `v1=${assinatura}`,
      },
      body: metodo === 'POST' ? bruto : undefined,
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (e) {
    throw new FalhaDeRede(
      (e as Error).name === 'TimeoutError'
        ? 'A API externa não respondeu a tempo.'
        : `Sem conexão com a API externa (${(e as Error).message}).`,
    );
  }
  const texto = await r.text().catch(() => '');
  let json: unknown;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  const erro = r.ok
    ? null
    : ((json as { erro?: { mensagem?: string; detalhes?: string[] } } | null)?.erro?.mensagem ??
        `HTTP ${r.status}`) +
      ((json as { erro?: { detalhes?: string[] } } | null)?.erro?.detalhes?.length
        ? ` (${(json as { erro: { detalhes: string[] } }).erro.detalhes.join('; ')})`
        : '');
  return {
    status: r.status,
    corpo: r.ok ? (json as T) : null,
    erro,
    requisicaoId: r.headers.get('x-request-id'),
  };
}
