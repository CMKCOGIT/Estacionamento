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
  /** Conexão criptografada com o MySQL (obrigatória nos provedores: Aiven, Railway...). */
  DB_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Certificado da autoridade do provedor (o "CA certificate" do Aiven): o texto
   * PEM inteiro (pode colar com quebras de linha) ou o caminho de um arquivo.
   * Sem ele, vale a lista de autoridades do sistema.
   */
  DB_SSL_CA: z.string().optional(),

  /** Origens do PWA (CORS). Só elas podem chamar a API pelo navegador. */
  PWA_ORIGENS: lista,
  /** Produção: recusa HTTP (redireciona GET para HTTPS) e liga HSTS. */
  FORCAR_HTTPS: booleano.optional(),
  /** Quantos proxies confiar para o IP e o protocolo (provedores usam 1). */
  CONFIAR_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** Consultas de ticket que FALHAM, por IP e por minuto (contra quem tenta adivinhar links). */
  LIMITE_TICKET_POR_MINUTO: z.coerce.number().int().min(1).max(1000).default(30),
  /** Consultas por ticket e por minuto (o app consulta a cada 30 s). */
  LIMITE_TICKET_POR_TOKEN_POR_MINUTO: z.coerce.number().int().min(2).max(1000).default(12),
  /** Teto de consultas por IP e por minuto (muitos clientes podem dividir o mesmo IP). */
  LIMITE_TICKET_TETO_POR_IP_POR_MINUTO: z.coerce.number().int().min(10).max(100_000).default(1200),

  /**
   * Chave mestra das integrações (servidor local de cada estacionamento).
   * O segredo de cada integração é derivado dela; sem ela, /sync fica desligado.
   */
  SYNC_CHAVE_MESTRA: z
    .string()
    .min(32, 'SYNC_CHAVE_MESTRA precisa de pelo menos 32 caracteres')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  LIMITE_SYNC_POR_MINUTO: z.coerce.number().int().min(10).max(10_000).default(240),
  /** Chave do HMAC que anonimiza o IP no registro (padrão: aleatória a cada início). */
  CHAVE_REGISTRO: z.string().min(16).optional(),
  /** Dias que o registro de requisições é mantido. */
  DIAS_REGISTRO: z.coerce.number().int().min(1).max(365).default(30),
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
