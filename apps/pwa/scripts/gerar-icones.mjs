/**
 * Gera os ícones PNG do app a partir de public/icones/icone.svg
 * (instalação: 192 e 512; "maskable" para Android; 180 para iPhone).
 *   npm run icones -w @estacionamento/pwa
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Playwright instalado no computador de quem gera os ícones (não é dependência do app)
const { chromium } = createRequire(import.meta.url)('playwright');

const pasta = fileURLToPath(new URL('../public/icones/', import.meta.url));
const svg = readFileSync(`${pasta}icone.svg`, 'utf8');
// Maskable e iPhone: fundo até a borda e desenho dentro da zona segura (80%)
const cheio = svg
  .replace(
    '<rect width="512" height="512" rx="112" fill="#0d5c55"/>',
    '<rect width="512" height="512" fill="#0d5c55"/>',
  )
  .replace('<g>', '<g transform="translate(51.2 51.2) scale(0.8)">');

const navegador = await chromium.launch();
const pagina = await navegador.newPage();
for (const [arquivo, tamanho, fonte, transparente] of [
  ['icone-192.png', 192, svg, true],
  ['icone-512.png', 512, svg, true],
  ['icone-maskable-512.png', 512, cheio, false],
  ['apple-touch-icon.png', 180, cheio, false],
]) {
  await pagina.setViewportSize({ width: tamanho, height: tamanho });
  await pagina.setContent(
    `<html><body style="margin:0;background:transparent">${fonte.replace('<svg ', `<svg width="${tamanho}" height="${tamanho}" `)}</body></html>`,
  );
  writeFileSync(`${pasta}${arquivo}`, await pagina.screenshot({ omitBackground: transparente }));
  console.log(`${arquivo} (${tamanho}px)`);
}
await navegador.close();
