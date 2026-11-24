/**
 * Liga este servidor local à API externa publicada (Conectar-Nuvem.cmd).
 * Pergunta o endereço da API, o do app do cliente e a chave mestra
 * (SYNC_CHAVE_MESTRA do Render), gera o segredo da credencial e grava as
 * 4 linhas no apps/local-server/.env. Passo a passo: docs/PUBLICAR.md.
 *
 *   npm run nuvem:conectar -w @estacionamento/local-server
 *   (ou sem perguntas) -- --api https://... --app https://... --chave <chave>
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import mysql from 'mysql2/promise';
import { config as carregarDotenv } from 'dotenv';

/** Mesmo id que o render.yaml cria na nuvem. */
export const ID_INTEGRACAO = '01JESTACIONAMENTOPRINCIPAL';
/** Mesma derivação da API externa (apps/cloud-api/src/integracoes/credenciais.ts). */
export const derivarSegredo = (chaveMestra: string, id = ID_INTEGRACAO, versao = 1) =>
  createHmac('sha256', chaveMestra).update(`integracao:${id}:${versao}`).digest('base64url');

const ARQUIVO_ENV = fileURLToPath(new URL('../.env', import.meta.url));
const args = process.argv.slice(2);
const arg = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined);

function normalizarUrl(v: string, nome: string): string {
  const t = v.trim().replace(/\/+$/, '');
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new Error(`${nome}: endereço inválido ("${t}"). Exemplo: https://estacionamento-api.onrender.com`);
  }
  if (u.protocol !== 'https:') throw new Error(`${nome}: precisa começar com https://`);
  return u.origin;
}

/** Troca (ou acrescenta) as chaves no .env, preservando o resto do arquivo. */
export function atualizarEnv(texto: string, valores: Record<string, string>): string {
  let saida = texto.replace(/\r\n/g, '\n');
  const faltam: string[] = [];
  for (const [k, v] of Object.entries(valores)) {
    const re = new RegExp(`^#?\\s*${k}=.*$`, 'm');
    if (re.test(saida)) saida = saida.replace(re, `${k}=${v}`);
    else faltam.push(`${k}=${v}`);
  }
  if (faltam.length)
    saida = `${saida.replace(/\n*$/, '\n')}\n# Nuvem (Conectar-Nuvem.cmd)\n${faltam.join('\n')}\n`;
  return saida.replace(/\n/g, '\r\n');
}

async function principal() {
  if (!existsSync(ARQUIVO_ENV))
    throw new Error('Arquivo apps/local-server/.env não encontrado. Rode o Atualizar.cmd primeiro.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const perguntar = async (n: string, texto: string) => arg(n) ?? (await rl.question(texto));
  try {
    const api = normalizarUrl(
      await perguntar(
        'api',
        '\n1) Endereço da API no Render (ex.: https://estacionamento-api.onrender.com): ',
      ),
      'API',
    );
    process.stdout.write(
      '   Conferindo a API... (no plano grátis, a primeira resposta pode levar 1 minuto)\n',
    );
    const saude = await fetch(`${api}/saude`, { signal: AbortSignal.timeout(90_000) }).catch((e: Error) => {
      throw new Error(`A API não respondeu em ${api}: ${e.message}`);
    });
    const corpo = (await saude.json().catch(() => null)) as { status?: string } | null;
    if (corpo?.status !== 'ok')
      throw new Error(
        `A API respondeu, mas com problema (HTTP ${saude.status}). Veja os logs no Render: provavelmente o banco (DB_*).`,
      );
    console.log('   API no ar.');
    const app = normalizarUrl(
      await perguntar('app', '\n2) Endereço do app do cliente (ex.: https://meu-estacionamento.pages.dev): '),
      'App',
    );
    const chave = (
      await perguntar(
        'chave',
        '\n3) SYNC_CHAVE_MESTRA (Render → estacionamento-api → Environment → copiar): ',
      )
    ).trim();
    if (chave.length < 32)
      throw new Error('A chave mestra tem pelo menos 32 caracteres. Copie o valor inteiro do Render.');

    const novo = atualizarEnv(readFileSync(ARQUIVO_ENV, 'utf8'), {
      CLOUD_API_URL: api,
      SYNC_INTEGRACAO_ID: ID_INTEGRACAO,
      SYNC_SECRET: derivarSegredo(chave),
      PUBLIC_PWA_URL: app,
    });
    writeFileSync(ARQUIVO_ENV, novo);
    console.log(
      '\nPronto: CLOUD_API_URL, SYNC_INTEGRACAO_ID, SYNC_SECRET e PUBLIC_PWA_URL gravados no .env.',
    );

    // O "slug" do estacionamento vai no VITE_SITE_SLUG do app (Cloudflare)
    carregarDotenv({ path: ARQUIVO_ENV, quiet: true });
    try {
      const c = await mysql.createConnection({
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 3306),
        user: process.env.DB_USER ?? 'root',
        password: process.env.DB_PASSWORD ?? '',
        database: process.env.DB_NAME ?? 'estacionamento',
      });
      const [linhas] = await c.query<mysql.RowDataPacket[]>(
        'SELECT slug FROM sites ORDER BY criado_em LIMIT 1',
      );
      await c.end();
      if (linhas[0]) console.log(`\nNo Cloudflare, use VITE_SITE_SLUG=${String(linhas[0].slug)}`);
    } catch {
      /* sem banco: o slug aparece em Configurações */
    }
    console.log('\nFeche a janela "Servidor do Estacionamento" e abra o Iniciar.cmd.');
    console.log('Em Configurações → Sincronização deve aparecer "Em dia" em até 1 minuto.');
  } finally {
    rl.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  principal().catch((e: unknown) => {
    console.error(`\nNão foi possível conectar: ${(e as Error).message}`);
    process.exitCode = 1;
  });
