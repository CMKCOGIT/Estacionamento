import { criarApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { fecharPool, pool } from './db/pool.js';
import { publicoRepository } from './modules/publico/publico.repository.js';

if (env.NODE_ENV === 'production' && env.CONFIAR_PROXY === 0)
  logger.warn(
    'CONFIAR_PROXY=0 em produção: atrás do proxy do provedor, todos os clientes parecem vir do mesmo IP ' +
      '(limites e registros ficam errados). Use CONFIAR_PROXY=1.',
  );

/**
 * Retenção: tickets encerrados há mais de 30 dias, nonces com mais de 10 min
 * (a janela da assinatura é de 5), confirmações de sincronização com mais
 * de 30 dias e o registro de requisições além de DIAS_REGISTRO.
 */
async function limparRegistrosVencidos() {
  try {
    const n = await publicoRepository.apagarRegistrosVencidos();
    if (n) logger.info({ tickets: n }, 'Tickets encerrados há mais de 30 dias apagados da nuvem');
    await pool.query('DELETE FROM sync_nonces WHERE recebido_em < NOW(3) - INTERVAL 10 MINUTE');
    await pool.query('DELETE FROM sync_aplicados WHERE aplicado_em < NOW(3) - INTERVAL 30 DAY');
    await pool.query('DELETE FROM registro_api WHERE ocorrido_em < NOW(3) - INTERVAL ? DAY', [
      env.DIAS_REGISTRO,
    ]);
  } catch (erro) {
    logger.warn({ erro }, 'Não foi possível apagar os tickets vencidos (tenta de novo depois)');
  }
}
void limparRegistrosVencidos();
const limpeza = setInterval(() => void limparRegistrosVencidos(), 10 * 60_000);
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
