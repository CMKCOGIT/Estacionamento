import { fileURLToPath } from 'node:url';
import { config as carregarDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Usa as credenciais do .env (se existir); só o NOME do banco é trocado.
carregarDotenv({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true });

// Variáveis padrão para testes. Os testes de integração usam um MySQL real:
// sobrescreva com DB_HOST/DB_USER/DB_PASSWORD/DB_NAME_TESTE no ambiente.
// O banco de teste é APAGADO e recriado a cada execução — nunca use o banco real.
const envTeste = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DB_HOST: process.env.DB_HOST ?? '127.0.0.1',
  DB_PORT: process.env.DB_PORT ?? '3306',
  DB_USER: process.env.DB_USER ?? 'root',
  DB_PASSWORD: process.env.DB_PASSWORD ?? '',
  DB_NAME: process.env.DB_NAME_TESTE ?? 'estacionamento_teste',
  SERVE_ADMIN_WEB: 'false',
  CORS_ORIGINS: '',
};

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], env: envTeste } },
      {
        test: {
          name: 'integracao',
          include: ['tests/integracao/**/*.test.ts'],
          env: envTeste,
          globalSetup: ['tests/integracao/setup-banco.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
