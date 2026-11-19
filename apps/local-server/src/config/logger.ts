import { pino } from 'pino';
import { emDesenvolvimento, env } from './env.js';

/**
 * Logger estruturado (JSON). Em desenvolvimento usa saída colorida legível.
 * Campos sensíveis nunca são gravados.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { servico: 'local-server' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.senha',
      '*.password',
      '*.token',
    ],
    censor: '[oculto]',
  },
  ...(emDesenvolvimento && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,servico' },
    },
  }),
});
