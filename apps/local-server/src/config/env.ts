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

  // Fuso do estacionamento para "hoje", relatórios e gráficos. Offset fixo
  // (o Brasil não tem horário de verão desde 2019; não depende das tabelas de
  // fuso do MySQL, que não vêm instaladas no Windows).
  FUSO_OFFSET: z
    .string()
    .regex(/^[+-]\d{2}:\d{2}$/, 'Use o formato -03:00')
    .default('-03:00'),

  // Autenticação
  SESSAO_INATIVIDADE_MIN: z.coerce
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .default(60),
  SESSAO_DURACAO_MAX_HORAS: z.coerce.number().int().min(1).max(72).default(12),
  LOGIN_MAX_TENTATIVAS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_BLOQUEIO_MIN: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(15),
  LOGIN_LIMITE_POR_IP: z.coerce.number().int().min(5).max(1000).default(20),
  COOKIE_SECURE: booleano.default(false),

  SERVE_ADMIN_WEB: booleano.default(true),
  ADMIN_WEB_DIST: z.string().optional(),

  // Sincronização com a API externa (nuvem). Sem as três, o envio fica desligado.
  SITE_ID: z.string().length(26).optional(),
  /** Endereço da API externa, sem caminho (ex.: https://api.meuestacionamento.com.br). */
  CLOUD_API_URL: z
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Credencial criada na API externa (npm run integracao -- criar). */
  SYNC_INTEGRACAO_ID: z
    .string()
    .regex(/^[0-9A-Z]{26}$/, 'SYNC_INTEGRACAO_ID inválido')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  SYNC_SECRET: z
    .string()
    .min(32, 'SYNC_SECRET muito curto')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** false = não envia (ex.: servidor de testes). */
  SYNC_ATIVO: booleano.default(true),
  /** Endereço do app do cliente (PWA). Usado no link/QR do ticket. */
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
  const env = resultado.data;
  const url = env.CLOUD_API_URL;
  if (
    env.NODE_ENV === 'production' &&
    url &&
    !url.startsWith('https://') &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)
  ) {
    throw new Error('Em produção, CLOUD_API_URL precisa começar com https:// (os dados vão pela internet).');
  }
  return env;
}

export const env = carregarEnv();
export const emProducao = env.NODE_ENV === 'production';
export const emDesenvolvimento = env.NODE_ENV === 'development';
