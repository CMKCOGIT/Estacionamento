import { fileURLToPath } from 'node:url';
import { config as carregarDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Usa as credenciais do .env (se existir); só o NOME do banco é trocado.
carregarDotenv({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true });

// Variáveis padrão para testes. Os testes de integração usam um MySQL real:
// sobrescreva com DB_HOST/DB_USER/DB_PASSWORD/DB_NAME_TESTE no ambiente.
// Cada arquivo de teste cria e apaga o PRÓPRIO banco (estacionamento_teste_*): o real nunca é tocado.
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
  // Backups: pasta temporária; MYSQL_BIN_DIR do ambiente (mysqldump/mysql)
  BACKUP_DIR: fileURLToPath(new URL('./.teste-backups', import.meta.url)),
  ...(process.env.MYSQL_BIN_DIR ? { MYSQL_BIN_DIR: process.env.MYSQL_BIN_DIR } : {}),
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
          setupFiles: ['tests/integracao/banco-por-arquivo.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
