/// <reference lib="webworker" />
import { estrategiaPara } from './sw-regras';

declare const self: ServiceWorkerGlobalScope;
// Direto do build (não importa módulos do app: o worker precisa ser um arquivo só)
declare const __API_URL__: string;

/** Preenchidos no build (vite.config.ts): arquivos do app e versão. */
const ARQUIVOS: string[] = '__ARQUIVOS_DO_APP__' as unknown as string[];
const VERSAO = '__VERSAO_DO_APP__';
const CACHE_APP = `app-${VERSAO}`;
const CACHE_DADOS = 'dados-publicos';
const ORIGEM_API = new URL(__API_URL__).origin;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_APP).then((c) => c.addAll(Array.isArray(ARQUIVOS) ? ARQUIVOS : ['/'])));
});

self.addEventListener('activate', (e) => {
  // Apaga versões antigas do app (os dados públicos continuam)
  e.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(
          chaves.filter((k) => k.startsWith('app-') && k !== CACHE_APP).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// A tela pede para ativar a versão nova quando o cliente toca em "Atualizar"
self.addEventListener('message', (e) => {
  if (e.data === 'ativar-nova-versao') void self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  const estrategia = estrategiaPara(
    { url: r.url, method: r.method, mode: r.mode, temAutorizacao: r.headers.has('authorization') },
    self.location.origin,
    ORIGEM_API,
  );
  if (estrategia === 'ignorar' || estrategia === 'somente-rede') return; // o navegador busca direto, sem cache

  if (estrategia === 'navegacao') {
    // Rede primeiro; sem internet, o app guardado (rotas são do próprio app)
    e.respondWith(
      fetch(r).catch(
        async () => (await caches.match('/', { cacheName: CACHE_APP, ignoreVary: true })) ?? Response.error(),
      ),
    );
    return;
  }
  if (estrategia === 'app') {
    e.respondWith(
      // ignoreVary: os arquivos do app têm o hash no nome (nunca há duas versões no mesmo endereço)
      caches.match(r, { cacheName: CACHE_APP, ignoreVary: true }).then(
        (guardado) =>
          guardado ??
          fetch(r).then((resposta) => {
            if (resposta.ok) void caches.open(CACHE_APP).then((c) => c.put(r, resposta.clone()));
            return resposta;
          }),
      ),
    );
    return;
  }
  // Dados públicos: rede primeiro, última cópia sem internet
  e.respondWith(
    fetch(r)
      .then((resposta) => {
        if (resposta.ok) void caches.open(CACHE_DADOS).then((c) => c.put(r, resposta.clone()));
        return resposta;
      })
      .catch(
        async () => (await caches.match(r, { cacheName: CACHE_DADOS, ignoreVary: true })) ?? Response.error(),
      ),
  );
});
