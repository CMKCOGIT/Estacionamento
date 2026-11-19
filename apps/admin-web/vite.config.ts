import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Em desenvolvimento o painel roda em http://localhost:5173 e repassa /api
// para o servidor local (porta 8080). Em produção o próprio servidor local
// entrega os arquivos de dist/, então as chamadas são no mesmo endereço.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:8080', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
