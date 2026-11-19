import { fileURLToPath } from 'node:url';
import { config as carregarDotenv } from 'dotenv';
import { z } from 'zod';

// Carrega apps/local-server/.env independentemente da pasta de onde o
// processo foi iniciado (importante quando rodar como serviço do Windows).
// Funciona tanto em src/config quanto em dist/config.
carregarDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

const booleano = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const listaSeparadaPorVirgula = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schemaEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: listaSeparadaPorVirgula,

  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_USER: z.string().min(1, 'DB_USER é obrigatório'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1).default('estacionamento'),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

  SERVE_ADMIN_WEB: booleano.default(true),
  ADMIN_WEB_DIST: z.string().optional(),

  // Futuro (sincronização)
  SITE_ID: z.string().length(26).optional(),
  CLOUD_API_URL: z.url().optional(),
  PUBLIC_PWA_URL: z.url().optional(),
});

export type Env = z.infer<typeof schemaEnv>;

function carregarEnv(): Env {
  const resultado = schemaEnv.safeParse(process.env);
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Configuração inválida. Verifique o arquivo apps/local-server/.env ` +
        `(use .env.example como modelo):\n${problemas}`,
    );
  }
  return resultado.data;
}

export const env = carregarEnv();
export const emProducao = env.NODE_ENV === 'production';
export const emDesenvolvimento = env.NODE_ENV === 'development';
