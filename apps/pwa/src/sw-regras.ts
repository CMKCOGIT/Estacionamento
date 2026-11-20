/**
 * Decide o que o service worker faz com cada requisição. Função pura
 * (testada em tests/sw-regras.test.ts) usada por src/sw.ts.
 *
 * - App (HTML, JS, CSS, ícones): sempre disponível, também sem internet.
 * - Vagas livres e tarifas: rede primeiro; sem internet, a última cópia.
 * - Ticket: SÓ rede. É dado pessoal e vai com o token: nunca vai para cache.
 */
export type Estrategia = 'navegacao' | 'app' | 'dados-publicos' | 'somente-rede' | 'ignorar';

export function estrategiaPara(
  r: { url: string; method: string; mode?: string; temAutorizacao?: boolean },
  origemApp: string,
  origemApi: string,
): Estrategia {
  if (r.method !== 'GET') return 'ignorar';
  const u = new URL(r.url);
  if (u.origin === origemApi && u.pathname.startsWith('/v1/')) {
    if (u.pathname === '/v1/ticket' || r.temAutorizacao) return 'somente-rede';
    if (/^\/v1\/sites\/[a-z0-9-]+\/(disponibilidade|tarifas)$/.test(u.pathname)) return 'dados-publicos';
    return 'somente-rede';
  }
  if (u.origin !== origemApp) return 'ignorar';
  if (r.mode === 'navigate') return 'navegacao';
  if (u.pathname === '/sw.js') return 'ignorar';
  return 'app';
}
