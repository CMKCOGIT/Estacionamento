import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * PWA do cliente.
 * - VITE_API_URL: endereço da API pública externa (HTTPS em produção).
 * - VITE_SITE_SLUG: estacionamento mostrado na tela inicial.
 */
export default defineConfig(({ mode }) => {
  const e = loadEnv(mode, process.cwd(), 'VITE_');
  const api = (e.VITE_API_URL || 'http://localhost:8090').replace(/\/+$/, '');
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(api);
  if (mode === 'production' && !api.startsWith('https://') && !local) {
    throw new Error(`VITE_API_URL precisa ser https:// em produção (recebido: ${api})`);
  }
  const origemApi = new URL(api).origin;

  // Política de segurança: só o próprio app e a API pública; nada de scripts de terceiros.
  const csp = [
    "default-src 'self'",
    `connect-src 'self' ${origemApi}`,
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    ...(local ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  return {
    define: {
      __API_URL__: JSON.stringify(api),
      __SITE_SLUG__: JSON.stringify(e.VITE_SITE_SLUG || 'estacionamento'),
    },
    plugins: [react(), ...(mode === 'https' ? [basicSsl()] : []), arquivosDoPwa(csp)],
    server: { port: 5174 },
    preview: { port: 5174 },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        input: { app: 'index.html', sw: 'src/sw.ts' },
        output: { entryFileNames: (c) => (c.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
      },
    },
  };
});

/** CSP no HTML, lista de arquivos do app no service worker e cabeçalhos da hospedagem. */
function arquivosDoPwa(csp: string): Plugin {
  return {
    name: 'arquivos-do-pwa',
    transformIndexHtml: (html) => html.replace('%CSP%', csp),
    generateBundle(_o, bundle) {
      const sw = Object.values(bundle).find((c) => c.type === 'chunk' && c.fileName === 'sw.js');
      if (!sw || sw.type !== 'chunk') return;
      const arquivos = Object.keys(bundle)
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith('_'))
        .map((f) => `/${f}`);
      // Arquivos de public/ (manifesto e ícones) não passam pelo bundle: entram pela pasta
      const publicos = readdirSync('public', { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => `/${relative('public', join(d.parentPath, d.name)).split(sep).join('/')}`);
      const precache = ['/', ...arquivos.filter((f) => f !== '/index.html'), ...publicos].sort();
      const versao = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 12);
      // O minificador pode trocar as aspas do marcador: aceita ", ' ou `
      const marcador = /["'`]__ARQUIVOS_DO_APP__["'`]/;
      if (!marcador.test(sw.code) || !sw.code.includes('__VERSAO_DO_APP__')) {
        this.error(
          'Marcadores do service worker não encontrados: o app não ficaria disponível sem internet.',
        );
      }
      sw.code = sw.code.replace(marcador, JSON.stringify(precache)).replace('__VERSAO_DO_APP__', versao);

      // Cloudflare Pages / Netlify: cabeçalhos de segurança e rota única do app
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: [
          '/*',
          `  Content-Security-Policy: ${csp}; frame-ancestors 'none'`,
          '  Referrer-Policy: no-referrer',
          '  X-Content-Type-Options: nosniff',
          '  X-Frame-Options: DENY',
          '  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()',
          '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
          '/sw.js',
          '  Cache-Control: no-cache',
          '/manifest.webmanifest',
          '  Cache-Control: no-cache',
          '/assets/*',
          '  Cache-Control: public, max-age=31536000, immutable',
          '',
        ].join('\n'),
      });
      this.emitFile({ type: 'asset', fileName: '_redirects', source: '/*  /index.html  200\n' });
    },
  };
}
