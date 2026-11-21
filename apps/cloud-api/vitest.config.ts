import { defineConfig } from 'vitest/config';

// Testes contra um MySQL real, num banco próprio (estacionamento_nuvem_teste), recriado a cada execução.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DB_HOST: process.env.DB_HOST ?? '127.0.0.1',
      DB_PORT: process.env.DB_PORT ?? '3306',
      DB_USER: process.env.DB_USER ?? 'root',
      DB_PASSWORD: process.env.DB_PASSWORD ?? '',
      DB_NAME: 'estacionamento_nuvem_teste',
      PWA_ORIGENS: 'https://app.exemplo.com.br',
      LIMITE_TICKET_POR_MINUTO: '8',
      SYNC_CHAVE_MESTRA: 'chave-mestra-de-teste-com-mais-de-32-caracteres',
    },
  },
});
