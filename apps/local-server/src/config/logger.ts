import { pino, stdSerializers, type LoggerOptions } from 'pino';
import { mascararDadosPessoais, mascararObjeto } from '@estacionamento/shared';
import { emDesenvolvimento, env } from './env.js';

/**
 * Logger estruturado (JSON). Em desenvolvimento usa saída colorida legível.
 *
 * Proteção de dados (LGPD): o log serve para diagnóstico, não para guardar
 * quem estacionou. Por isso:
 *  - senhas, tokens, cookies e cabeçalhos de autorização nunca são gravados;
 *  - campos de dados pessoais (placa, CPF, e-mail, telefone...) viram [oculto];
 *  - placas, CPFs, e-mails e telefones dentro de mensagens são mascarados;
 *  - a URL é gravada sem a query string (ex.: ?termo=<placa>);
 *  - erros do MySQL perdem o SQL com os valores.
 */
export const opcoesLogger: LoggerOptions = {
  base: { servico: 'local-server' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.senha',
      '*.senhaAtual',
      '*.novaSenha',
      '*.password',
      '*.token',
      '*.segredo',
      '*.placa',
      '*.cpf',
      '*.documento',
      '*.email',
      '*.telefone',
      'placa',
      'cpf',
      'documento',
      'email',
      'telefone',
      'senha',
      'token',
      'err.sql',
      'err.parameters',
      'err.values',
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
  hooks: {
    // Mascara dados pessoais em mensagens e campos de texto antes de gravar
    logMethod(args, metodo) {
      metodo.apply(
        this,
        args.map((a) => (typeof a === 'string' ? mascararDadosPessoais(a) : mascararObjeto(a))) as Parameters<
          typeof metodo
        >,
      );
    },
  },
};

export const logger = pino({
  ...opcoesLogger,
  level: env.LOG_LEVEL,
  ...(emDesenvolvimento && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,servico' },
    },
  }),
});
