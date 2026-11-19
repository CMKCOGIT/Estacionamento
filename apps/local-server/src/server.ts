import type { Server } from 'node:http';

/**
 * Ponto de entrada do servidor local.
 * A configuração é carregada primeiro: se o .env estiver inválido, o processo
 * encerra com uma mensagem clara antes de tentar abrir porta ou conectar no banco.
 */
async function iniciar(): Promise<void> {
  let modulos;
  try {
    const [{ env }, { logger }, { appInfo }, { criarApp }, { verificarBanco }, { fecharPool }] =
      await Promise.all([
        import('./config/env.js'),
        import('./config/logger.js'),
        import('./config/app-info.js'),
        import('./app.js'),
        import('./db/saude.js'),
        import('./db/pool.js'),
      ]);
    modulos = { env, logger, appInfo, criarApp, verificarBanco, fecharPool };
  } catch (erro) {
    // O logger pode não existir ainda (a falha pode ser justamente na configuração).
    // eslint-disable-next-line no-console
    console.error(`\n[local-server] Falha ao iniciar:\n${(erro as Error).message}\n`);
    process.exit(1);
  }

  const { env, logger, appInfo, criarApp, verificarBanco, fecharPool } = modulos;

  // Testa o banco na inicialização. Se estiver fora, o servidor sobe mesmo
  // assim (o painel mostra o problema em /api/v1/health) e tenta de novo a
  // cada requisição — o pool reconecta sozinho quando o MySQL voltar.
  const banco = await verificarBanco();
  if (banco.ok) logger.info({ versao: banco.versao, banco: banco.nome }, 'MySQL conectado');
  else logger.warn({ motivo: banco.erro }, 'MySQL indisponível — a API responderá 503 até o banco voltar');

  const servidor: Server = criarApp().listen(env.PORT, env.HOST, () => {
    logger.info(
      { versao: appInfo.versao, ambiente: env.NODE_ENV },
      `Servidor local ouvindo em http://${env.HOST === '0.0.0.0' ? 'localhost' : env.HOST}:${env.PORT}`,
    );
  });

  servidor.on('error', (erro: NodeJS.ErrnoException) => {
    if (erro.code === 'EADDRINUSE') {
      logger.fatal(`A porta ${env.PORT} já está em uso. Feche o outro programa ou altere PORT no .env.`);
    } else {
      logger.fatal({ err: erro }, 'Erro ao abrir o servidor HTTP');
    }
    process.exit(1);
  });

  // Encerramento gracioso: para de aceitar conexões, termina as requisições
  // em andamento e fecha o pool do MySQL.
  let encerrando = false;
  const encerrar = (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    logger.info({ sinal }, 'Encerrando servidor...');
    const forcar = setTimeout(() => {
      logger.error('Encerramento demorou mais de 10s; forçando saída');
      process.exit(1);
    }, 10_000);
    forcar.unref();
    servidor.close(async () => {
      await fecharPool().catch((e: unknown) => logger.error({ err: e }, 'Erro ao fechar o pool MySQL'));
      logger.info('Servidor encerrado');
      process.exit(0);
    });
    servidor.closeIdleConnections();
  };

  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('unhandledRejection', (motivo) =>
    logger.error({ err: motivo }, 'Promise rejeitada sem tratamento'),
  );
  process.on('uncaughtException', (erro) => {
    logger.fatal({ err: erro }, 'Exceção não tratada — encerrando');
    process.exit(1);
  });
}

void iniciar();
