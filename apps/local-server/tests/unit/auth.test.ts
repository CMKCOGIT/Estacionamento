import express from 'express';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { problemasDaSenha } from '@estacionamento/shared';
import { logger } from '../../src/config/logger.js';
import { exigirPermissao } from '../../src/http/middlewares/autenticacao.js';
import { verificarOrigem } from '../../src/http/middlewares/origem.js';
import { tratarErros } from '../../src/http/middlewares/tratar-erros.js';
import type { Autenticacao } from '../../src/modules/auth/auth.service.js';
import { LimitadorDeTentativas } from '../../src/modules/auth/limitador.js';
import { conferirSenha, gerarHashSenha } from '../../src/modules/auth/senha.js';

describe('hash de senha (argon2id)', () => {
  it('gera hashes diferentes para a mesma senha (salt) e confere corretamente', async () => {
    const a = await gerarHashSenha('MinhaSenha1');
    const b = await gerarHashSenha('MinhaSenha1');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\$argon2id\$/);
    expect(await conferirSenha(a, 'MinhaSenha1')).toBe(true);
    expect(await conferirSenha(a, 'minhasenha1')).toBe(false);
  });

  it('hash corrompido não lança erro: apenas não confere', async () => {
    expect(await conferirSenha('lixo', 'qualquer')).toBe(false);
  });
});

describe('política de senha', () => {
  it.each([
    ['curta1', 'pelo menos 8'],
    ['somenteletras', 'letras e números'],
    ['12345678', 'letras e números'],
    ['joao2026senha', 'login'],
  ])('"%s" → %s', (senha, trecho) => {
    expect(problemasDaSenha(senha, 'joao').join(' ')).toMatch(new RegExp(trecho, 'i'));
  });

  it('senha boa não tem problemas', () => {
    expect(problemasDaSenha('Estaciona2026', 'joao')).toEqual([]);
  });
});

describe('LimitadorDeTentativas', () => {
  it('libera depois que a janela passa', () => {
    let agora = 0;
    const l = new LimitadorDeTentativas(3, 60_000, () => agora);
    l.registrarFalha('ip');
    l.registrarFalha('ip');
    expect(l.segundosParaLiberar('ip')).toBe(0);
    l.registrarFalha('ip');
    expect(l.segundosParaLiberar('ip')).toBe(60);
    agora = 30_000;
    expect(l.segundosParaLiberar('ip')).toBe(30);
    agora = 60_001;
    expect(l.segundosParaLiberar('ip')).toBe(0);
  });

  it('chaves são independentes e limpar zera', () => {
    const l = new LimitadorDeTentativas(1, 60_000);
    l.registrarFalha('a');
    expect(l.segundosParaLiberar('a')).toBeGreaterThan(0);
    expect(l.segundosParaLiberar('b')).toBe(0);
    l.limpar('a');
    expect(l.segundosParaLiberar('a')).toBe(0);
  });
});

function appComAuth(permissoes: string[]) {
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use((req, _res, next) => {
    req.auth = { temPermissao: (p: string) => permissoes.includes(p) } as Autenticacao;
    next();
  });
  app.get('/tarifas', exigirPermissao('tarifa.ver'), (_req, res) => res.json({ ok: true }));
  app.post('/tarifas', exigirPermissao('tarifa.gerenciar', 'tarifa.publicar'), (_req, res) =>
    res.json({ ok: true }),
  );
  app.use(tratarErros);
  return app;
}

describe('exigirPermissao', () => {
  it('libera quem tem a permissão', async () => {
    await request(appComAuth(['tarifa.ver']))
      .get('/tarifas')
      .expect(200);
  });

  it('aceita qualquer UMA das permissões listadas', async () => {
    await request(appComAuth(['tarifa.publicar']))
      .post('/tarifas')
      .expect(200);
  });

  it('nega com 403 e informa a permissão necessária', async () => {
    const res = await request(appComAuth(['sessao.entrada']))
      .get('/tarifas')
      .expect(403);
    expect(res.body.erro).toMatchObject({
      codigo: 'SEM_PERMISSAO',
      detalhes: { necessaria: ['tarifa.ver'] },
    });
  });
});

describe('verificarOrigem', () => {
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use(verificarOrigem);
  app.all('/x', (_req, res) => res.json({ ok: true }));
  app.use(tratarErros);

  it('GET de qualquer origem passa (não altera dados)', async () => {
    await request(app).get('/x').set('Origin', 'http://outro.com').expect(200);
  });
  it('POST sem Origin passa (scripts, testes)', async () => {
    await request(app).post('/x').expect(200);
  });
  it('POST da mesma origem passa', async () => {
    const res = await request(app)
      .post('/x')
      .set('Host', 'servidor:8080')
      .set('Origin', 'http://servidor:8080');
    expect(res.status).toBe(200);
  });
  it('POST de outra origem → 403', async () => {
    const res = await request(app).post('/x').set('Origin', 'http://malicioso.com').expect(403);
    expect(res.body.erro.codigo).toBe('ORIGEM_NAO_PERMITIDA');
  });
});
