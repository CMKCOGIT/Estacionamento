import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { criarApp } from '../../src/app.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { traduzirErroMysql } from '../../src/http/erros-mysql.js';

const app = criarApp();
afterAll(() => fecharPool());

describe('GET /api/v1/health', () => {
  it('responde 200 com o banco conectado', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.banco.ok).toBe(true);
    expect(res.body.banco.versao).toMatch(/^8\./);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('/api/v1/formas-pagamento', () => {
  it('lista as 4 formas da v1 em ordem', async () => {
    const res = await request(app).get('/api/v1/formas-pagamento').expect(200);
    expect(res.body.itens.map((f: { codigo: string }) => f.codigo)).toEqual([
      'DINHEIRO',
      'PIX',
      'DEBITO',
      'CREDITO',
    ]);
    expect(res.body.itens[0]).toMatchObject({ nome: 'Dinheiro', permiteTroco: true });
  });

  it('busca por código (sem diferenciar maiúsculas)', async () => {
    const res = await request(app).get('/api/v1/formas-pagamento/pix').expect(200);
    expect(res.body).toMatchObject({ codigo: 'PIX', exigeAutorizacao: true });
  });

  it('404 no formato padrão para código inexistente', async () => {
    const res = await request(app).get('/api/v1/formas-pagamento/CHEQUE').expect(404);
    expect(res.body.erro).toMatchObject({ codigo: 'NAO_ENCONTRADO' });
    expect(res.body.erro.requestId).toBeTruthy();
  });

  it('400 com detalhes para parâmetro inválido', async () => {
    const res = await request(app).get('/api/v1/formas-pagamento?ativas=talvez').expect(400);
    expect(res.body.erro.codigo).toBe('REQUISICAO_INVALIDA');
    expect(res.body.erro.detalhes[0].campo).toBe('ativas');
  });
});

describe('comTransacao', () => {
  it('faz rollback em caso de erro', async () => {
    await expect(
      comTransacao({}, async (c) => {
        await c.query("INSERT INTO formas_pagamento (codigo, nome) VALUES ('TESTE_RB', 'x')");
        throw new Error('falha proposital');
      }),
    ).rejects.toThrow('falha proposital');
    const [linhas] = await pool.query<RowDataPacket[]>(
      "SELECT 1 FROM formas_pagamento WHERE codigo='TESTE_RB'",
    );
    expect(linhas).toHaveLength(0);
  });

  it('grava o usuário e o motivo no histórico automático (triggers)', async () => {
    await comTransacao(
      { usuarioId: '01JTESTEUSUARIO00000000000', motivo: 'teste de auditoria' },
      async (c) => {
        await c.query(
          "INSERT INTO sites (id, slug, nome) VALUES ('01JTESTESITE00000000000000', 'teste', 'Teste')",
        );
        await c.query(
          "INSERT INTO configuracoes (site_id, chave, valor) VALUES ('01JTESTESITE00000000000000', 'retencao_anos', '5')",
        );
      },
    );
    const [linhas] = await pool.query<RowDataPacket[]>(
      "SELECT usuario_id, motivo, origem FROM historico_atividades WHERE acao = 'config.criada'",
    );
    expect(linhas[0]).toMatchObject({
      usuario_id: '01JTESTEUSUARIO00000000000',
      motivo: 'teste de auditoria',
      origem: 'DB',
    });
  });

  it('não vaza o usuário para a próxima requisição', async () => {
    await comTransacao({ usuarioId: 'VAZAMENTO' }, async () => undefined);
    // Pool de 1 conexão neste teste não é garantido, então verificamos todas as conexões ociosas
    const conexoes = await Promise.all(Array.from({ length: 3 }, () => pool.getConnection()));
    for (const c of conexoes) {
      const [[linha]] = await c.query<RowDataPacket[]>('SELECT @app_usuario_id AS u');
      expect(linha?.u).toBeNull();
      c.release();
    }
  });
});

describe('erros reais do banco são traduzidos', () => {
  it('trigger (SIGNAL 45000) → 422 REGRA_DE_NEGOCIO com a mensagem do trigger', async () => {
    const erro = await pool.query('DELETE FROM historico_atividades').catch((e: unknown) => e);
    expect(traduzirErroMysql(erro)).toMatchObject({
      status: 422,
      codigo: 'REGRA_DE_NEGOCIO',
      message: expect.stringContaining('retenção'),
    });
  });

  it('chave única → 409 REGISTRO_DUPLICADO', async () => {
    const erro = await pool
      .query("INSERT INTO formas_pagamento (codigo, nome) VALUES ('PIX', 'dup')")
      .catch((e: unknown) => e);
    expect(traduzirErroMysql(erro)).toMatchObject({ status: 409, detalhes: { restricao: 'PRIMARY' } });
  });
});
