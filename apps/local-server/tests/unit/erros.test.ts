import express from 'express';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { criarApp } from '../../src/app.js';
import { logger } from '../../src/config/logger.js';
import { erros } from '../../src/http/erros.js';
import { traduzirErroMysql } from '../../src/http/erros-mysql.js';
import { rotaNaoEncontrada, tratarErros } from '../../src/http/middlewares/tratar-erros.js';

/** App mínimo com rotas que lançam cada tipo de erro. */
function appDeTeste() {
  const app = express();
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1kb' }));
  app.get('/app-error', () => {
    throw erros.regraDeNegocio('Vaga ocupada');
  });
  app.get('/zod', (req) => {
    z.object({ placa: z.string().min(7) }).parse(req.query);
  });
  app.get('/mysql-dup', async () => {
    throw Object.assign(new Error('dup'), {
      errno: 1062,
      sqlMessage: "Duplicate entry 'ABC1234' for key 'veiculos.uq_veiculos_placa'",
    });
  });
  app.get('/inesperado', async () => {
    throw new Error('bug');
  });
  app.post('/json', (req, res) => {
    res.json(req.body);
  });
  app.use(rotaNaoEncontrada);
  app.use(tratarErros);
  return app;
}

describe('tratamento centralizado de erros', () => {
  const app = appDeTeste();

  it('AppError → status e código definidos', async () => {
    const res = await request(app).get('/app-error').expect(422);
    expect(res.body).toEqual({
      erro: { codigo: 'REGRA_DE_NEGOCIO', mensagem: 'Vaga ocupada', requestId: expect.any(String) },
    });
  });

  it('ZodError → 400 com campos inválidos', async () => {
    const res = await request(app).get('/zod?placa=AB').expect(400);
    expect(res.body.erro.codigo).toBe('REQUISICAO_INVALIDA');
    expect(res.body.erro.detalhes).toEqual([{ campo: 'placa', mensagem: expect.any(String) }]);
  });

  it('erro async do MySQL (duplicado) → 409 com a restrição', async () => {
    const res = await request(app).get('/mysql-dup').expect(409);
    expect(res.body.erro).toMatchObject({
      codigo: 'REGISTRO_DUPLICADO',
      detalhes: { restricao: 'uq_veiculos_placa' },
    });
  });

  it('erro inesperado → 500 sem derrubar o servidor', async () => {
    const res = await request(app).get('/inesperado').expect(500);
    expect(res.body.erro.codigo).toBe('ERRO_INTERNO');
  });

  it('JSON malformado → 400 JSON_INVALIDO', async () => {
    const res = await request(app)
      .post('/json')
      .set('Content-Type', 'application/json')
      .send('{x')
      .expect(400);
    expect(res.body.erro.codigo).toBe('JSON_INVALIDO');
  });

  it('corpo grande demais → 413', async () => {
    const res = await request(app)
      .post('/json')
      .send({ x: 'a'.repeat(2000) })
      .expect(413);
    expect(res.body.erro.codigo).toBe('CORPO_MUITO_GRANDE');
  });

  it('rota inexistente → 404 ROTA_NAO_ENCONTRADA', async () => {
    const res = await request(app).get('/nao-existe').expect(404);
    expect(res.body.erro.codigo).toBe('ROTA_NAO_ENCONTRADA');
  });
});

describe('traduzirErroMysql', () => {
  it.each([
    [{ errno: 1644, sqlMessage: 'Vaga ocupada' }, 422, 'REGRA_DE_NEGOCIO'],
    [
      { errno: 3819, sqlMessage: "Check constraint 'ck_veiculos_placa' is violated." },
      422,
      'DADOS_INVALIDOS',
    ],
    [{ errno: 1452 }, 422, 'DADOS_INVALIDOS'],
    [{ errno: 1451 }, 409, 'REGISTRO_EM_USO'],
    [{ code: 'ECONNREFUSED' }, 503, 'BANCO_INDISPONIVEL'],
    [{ code: 'ER_ACCESS_DENIED_ERROR' }, 503, 'BANCO_INDISPONIVEL'],
  ])('%o → %i %s', (erro, status, codigo) => {
    expect(traduzirErroMysql(erro)).toMatchObject({ status, codigo });
  });

  it('mensagem do trigger é repassada ao usuário', () => {
    expect(traduzirErroMysql({ errno: 1644, sqlMessage: 'Vaga ocupada' })?.message).toBe('Vaga ocupada');
  });

  it('erro desconhecido → null', () => {
    expect(traduzirErroMysql(new Error('x'))).toBeNull();
  });
});

describe('app', () => {
  const app = criarApp();

  it('liveness não depende do banco', async () => {
    await request(app).get('/api/v1/health/live').expect(200, { status: 'ok' });
  });

  it('rota /api inexistente → 404 JSON', async () => {
    const res = await request(app).get('/api/v2/qualquer').expect(404);
    expect(res.body.erro.codigo).toBe('ROTA_NAO_ENCONTRADA');
  });

  it('aplica cabeçalhos de segurança e reaproveita X-Request-Id válido', async () => {
    const res = await request(app).get('/api/v1/health/live').set('X-Request-Id', 'abc-12345');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-request-id']).toBe('abc-12345');
  });
});
