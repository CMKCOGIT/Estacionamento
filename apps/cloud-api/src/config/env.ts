import { fileURLToPath } from 'node:url';
import { config as carregarDotenv } from 'dotenv';
import { z } from 'zod';

carregarDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const booleano = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const lista = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8090),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().min(1, 'DB_USER é obrigatório'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1).default('estacionamento_nuvem'),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

  /** Origens do PWA (CORS). Só elas podem chamar a API pelo navegador. */
  PWA_ORIGENS: lista,
  /** Produção: recusa HTTP (redireciona GET para HTTPS) e liga HSTS. */
  FORCAR_HTTPS: booleano.optional(),
  /** Quantos proxies confiar para o IP e o protocolo (provedores usam 1). */
  CONFIAR_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  LIMITE_TICKET_POR_MINUTO: z.coerce.number().int().min(1).max(1000).default(30),
});

function carregar() {
  const r = schema.safeParse(process.env);
  if (!r.success) {
    const problemas = r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida da API externa (apps/cloud-api/.env):\n${problemas}`);
  }
  const env = r.data;
  if (env.NODE_ENV === 'production' && env.PWA_ORIGENS.some((o) => !o.startsWith('https://'))) {
    throw new Error('Em produção, PWA_ORIGENS deve conter só endereços https://');
  }
  return { ...env, FORCAR_HTTPS: env.FORCAR_HTTPS ?? env.NODE_ENV === 'production' };
}

export const env = carregar();
