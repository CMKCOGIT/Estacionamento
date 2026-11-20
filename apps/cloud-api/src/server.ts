import { criarApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { fecharPool } from './db/pool.js';
import { publicoRepository } from './modules/publico/publico.repository.js';

/** Retenção: apaga da nuvem os tickets encerrados há mais de 30 dias. */
async function limparRegistrosVencidos() {
  try {
    const n = await publicoRepository.apagarRegistrosVencidos();
    if (n) logger.info({ tickets: n }, 'Tickets encerrados há mais de 30 dias apagados da nuvem');
  } catch (erro) {
    logger.warn({ erro }, 'Não foi possível apagar os tickets vencidos (tenta de novo depois)');
  }
}
void limparRegistrosVencidos();
const limpeza = setInterval(() => void limparRegistrosVencidos(), 60 * 60_000);
limpeza.unref();

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
