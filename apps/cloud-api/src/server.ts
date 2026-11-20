import { criarApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { fecharPool } from './db/pool.js';

const servidor = criarApp().listen(env.PORT, env.HOST, () => {
  logger.info(
    `API pública ouvindo em http://${env.HOST}:${env.PORT} (PWA autorizado: ${env.PWA_ORIGENS.join(', ') || 'nenhum'})`,
  );
});

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    servidor.close(() => void fecharPool().finally(() => process.exit(0)));
  });
}
