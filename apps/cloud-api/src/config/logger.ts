import { pino, stdSerializers } from 'pino';
import { mascararDadosPessoais, mascararObjeto } from '@estacionamento/shared';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { servico: 'cloud-api' },
  // Nunca registra o token do ticket nem cabeçalhos de autorização
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-assinatura"]',
      '*.placa',
      '*.token',
      '*.segredo',
      'placa',
      'token',
      'err.sql',
      'err.parameters',
    ],
    censor: '[oculto]',
  },
  serializers: {
    err: (e: Error) => {
      const s = stdSerializers.err(e) as unknown as Record<string, unknown>;
      for (const k of ['message', 'stack', 'sqlMessage'])
        if (typeof s[k] === 'string') s[k] = mascararDadosPessoais(s[k] as string);
      return s;
    },
  },
  // LGPD: placas e outros dados pessoais em mensagens são mascarados
  hooks: {
    logMethod(args, metodo) {
      metodo.apply(
        this,
        args.map((a) => (typeof a === 'string' ? mascararDadosPessoais(a) : mascararObjeto(a))) as Parameters<
          typeof metodo
        >,
      );
    },
  },
  ...(env.NODE_ENV === 'development' && {
    transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } },
  }),
});
