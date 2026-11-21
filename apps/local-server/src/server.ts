import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as criarServidorHttp, type Server } from 'node:http';
import { createServer as criarServidorHttps } from 'node:https';

/**
 * Ponto de entrada do servidor local.
 * A configuração é carregada primeiro: se o .env estiver inválido, o processo
 * encerra com uma mensagem clara antes de tentar abrir porta ou conectar no banco.
 */
async function iniciar(): Promise<void> {
  let modulos;
  try {
    const [
      { env },
      { logger },
      { appInfo },
      { criarApp },
      { verificarBanco },
      { fecharPool },
      { authService, limitadorPorIp },
    ] = await Promise.all([
      import('./config/env.js'),
      import('./config/logger.js'),
      import('./config/app-info.js'),
      import('./app.js'),
      import('./db/saude.js'),
      import('./db/pool.js'),
      import('./modules/auth/auth.service.js'),
    ]);
    const sync = await import('./sync/index.js');
    modulos = {
      env,
      logger,
      appInfo,
      criarApp,
      verificarBanco,
      fecharPool,
      authService,
      limitadorPorIp,
      sync,
    };
  } catch (erro) {
    // O logger pode não existir ainda (a falha pode ser justamente na configuração).
    // eslint-disable-next-line no-console
    console.error(`\n[local-server] Falha ao iniciar:\n${(erro as Error).message}\n`);
    process.exit(1);
  }

  const { env, logger, appInfo, criarApp, verificarBanco, fecharPool, authService, limitadorPorIp, sync } =
    modulos;

  // Testa o banco na inicialização. Se estiver fora, o servidor sobe mesmo
  // assim (o painel mostra o problema em /api/v1/health) e tenta de novo a
  // cada requisição — o pool reconecta sozinho quando o MySQL voltar.
  const banco = await verificarBanco();
  if (banco.ok) logger.info({ versao: banco.versao, banco: banco.nome }, 'MySQL conectado');
  else logger.warn({ motivo: banco.erro }, 'MySQL indisponível — a API responderá 503 até o banco voltar');

  // HTTPS na rede local (certificado em HTTPS_CERT_FILE/HTTPS_KEY_FILE) ou HTTP
  const app = criarApp();
  // Caminho relativo = relativo a apps/local-server (vale em src/ e em dist/)
  const pastaServidor = fileURLToPath(new URL('../', import.meta.url));
  const arquivo = (f: string) => (isAbsolute(f) ? f : resolve(pastaServidor, f));
  let servidor: Server;
  try {
    servidor = env.HTTPS
      ? (criarServidorHttps(
          {
            cert: readFileSync(arquivo(env.HTTPS_CERT_FILE!)),
            key: readFileSync(arquivo(env.HTTPS_KEY_FILE!)),
            minVersion: 'TLSv1.2',
          },
          app,
        ) as unknown as Server)
      : criarServidorHttp(app);
  } catch (erro) {
    logger.fatal(
      { err: erro },
      'Não foi possível ler o certificado HTTPS (HTTPS_CERT_FILE / HTTPS_KEY_FILE)',
    );
    process.exit(1);
  }
  servidor.listen(env.PORT, env.HOST, () => {
    logger.info(
      { versao: appInfo.versao, ambiente: env.NODE_ENV },
      `Servidor local ouvindo em ${env.HTTPS ? 'https' : 'http'}://${env.HOST === '0.0.0.0' ? 'localhost' : env.HOST}:${env.PORT}`,
    );
    if (!env.HTTPS && env.NODE_ENV === 'production')
      logger.warn(
        'Painel sem HTTPS: na rede local as senhas trafegam sem criptografia. Gere um certificado (npm run https:certificado) e configure HTTPS_CERT_FILE e HTTPS_KEY_FILE.',
      );
  });
  // Porta HTTP que só redireciona para o HTTPS (quem digitar http:// cai no endereço seguro)
  if (env.HTTPS && env.HTTP_REDIRECIONAR_PORTA) {
    criarServidorHttp((req, res) => {
      const host = (req.headers.host ?? 'localhost').replace(/:\d+$/, '');
      res.writeHead(301, { Location: `https://${host}:${env.PORT}${req.url ?? '/'}` }).end();
    })
      .on('error', (e) => logger.warn({ err: e }, 'Porta de redirecionamento HTTP indisponível'))
      .listen(env.HTTP_REDIRECIONAR_PORTA, env.HOST);
  }

  // Envio dos dados para a API externa (nuvem), se configurado no .env
  sync.iniciarSync();

  // Backup automático do banco (todo dia no BACKUP_HORA)
  const { iniciarAgendadorBackup } = await import('./backup/backup.service.js');
  iniciarAgendadorBackup();

  // LGPD: política de retenção aplicada todo dia (a primeira 5 min depois de iniciar)
  const { privacidadeService } = await import('./modules/privacidade/privacidade.service.js');
  const reter = () =>
    privacidadeService
      .executarRetencao()
      .then((r) => logger.info({ ...r }, 'Retenção de dados pessoais aplicada'))
      .catch((e: unknown) => logger.warn({ err: e }, 'Falha na retenção de dados (tenta de novo amanhã)'));
  setTimeout(reter, 5 * 60_000).unref();
  setInterval(reter, 24 * 3_600_000).unref();

  servidor.on('error', (erro: NodeJS.ErrnoException) => {
    if (erro.code === 'EADDRINUSE') {
      logger.fatal(`A porta ${env.PORT} já está em uso. Feche o outro programa ou altere PORT no .env.`);
    } else {
      logger.fatal({ err: erro }, 'Erro ao abrir o servidor HTTP');
    }
    process.exit(1);
  });

  // Rotina periódica: encerra no banco as sessões de login vencidas e limpa
  // o limitador de tentativas por IP.
  const faxina = setInterval(() => {
    limitadorPorIp.faxina();
    authService
      .encerrarSessoesVencidas()
      .then((n) => n > 0 && logger.info({ sessoes: n }, 'Sessões vencidas encerradas'))
      .catch((e: unknown) => logger.warn({ err: e }, 'Falha ao encerrar sessões vencidas'));
  }, 10 * 60_000);
  faxina.unref();

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
      await sync.pararSync();
      await fecharPool().catch((e: unknown) => logger.error({ err: e }, 'Erro ao fechar o pool MySQL'));
      logger.info('Servidor encerrado');
      process.exit(0);
    });
    servidor.closeIdleConnections();
  };

  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  const { registrarErroSistema } = await import('./monitoramento/erros.js');
  process.on('unhandledRejection', (motivo) => {
    logger.error({ err: motivo }, 'Promise rejeitada sem tratamento');
    registrarErroSistema({
      origem: 'PROCESSO',
      codigo: 'PROMISE_REJEITADA',
      mensagem: String((motivo as Error)?.message ?? motivo),
    });
  });
  process.on('uncaughtException', (erro) => {
    logger.fatal({ err: erro }, 'Exceção não tratada — encerrando');
    process.exit(1);
  });
}

void iniciar();
