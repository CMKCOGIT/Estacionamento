import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, describe, expect, it } from 'vitest';
import { fecharPool, pool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { contextoRequisicao } from '../../src/http/contexto-requisicao.js';

afterAll(() => fecharPool());

/**
 * Auditoria: banco TRAVADO (não caído). Sem limite de tempo, a tela do caixa
 * esperaria para sempre e a gravação poderia acontecer muito depois.
 */
describe('banco travado', () => {
  it('a transação é cortada no limite, desfeita, e o pool continua funcionando', async () => {
    await pool.query('CREATE TABLE IF NOT EXISTS teste_travado (id INT PRIMARY KEY)');
    const inicio = Date.now();
    const erro = await comTransacao(
      {},
      async (c) => {
        await c.query('INSERT INTO teste_travado (id) VALUES (1)');
        await c.query('SELECT SLEEP(4)'); // simula o MySQL travado
      },
      { limiteMs: 800 },
    ).catch((e: unknown) => e as { status?: number; codigo?: string });
    expect(Date.now() - inicio).toBeLessThan(2500);
    expect(erro).toMatchObject({ status: 503, codigo: 'BANCO_INDISPONIVEL' });
    // O MySQL desfaz a transação da conexão descartada: nada foi gravado
    const [linhas] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM teste_travado');
    expect(Number(linhas[0]!.n)).toBe(0);
    // Próximas operações funcionam normalmente
    await comTransacao({}, (c) => c.query('INSERT INTO teste_travado (id) VALUES (2)'));
    const [depois] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM teste_travado');
    expect(Number(depois[0]!.n)).toBe(1);
    await pool.query('DROP TABLE teste_travado');
  });

  it('requisição que já recebeu 503 não grava mais nada (nem antes, nem no meio da transação)', async () => {
    await pool.query('CREATE TABLE IF NOT EXISTS teste_expirada (id INT PRIMARY KEY)');
    // 1) Ficou presa antes da transação (ex.: na conferência do login) e o banco voltou depois
    const antes = await contextoRequisicao
      .run({ expirada: true }, () =>
        comTransacao({}, (c) => c.query('INSERT INTO teste_expirada VALUES (1)')),
      )
      .catch((e: unknown) => e as { status?: number });
    expect(antes).toMatchObject({ status: 503 });
    // 2) Expirou enquanto a transação rodava: desfeita no lugar do COMMIT
    const estado = { expirada: false };
    const meio = await contextoRequisicao
      .run(estado, () =>
        comTransacao({}, async (c) => {
          await c.query('INSERT INTO teste_expirada VALUES (2)');
          estado.expirada = true;
        }),
      )
      .catch((e: unknown) => e as { status?: number });
    expect(meio).toMatchObject({ status: 503 });
    const [linhas] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM teste_expirada');
    expect(Number(linhas[0]!.n)).toBe(0);
    await pool.query('DROP TABLE teste_expirada');
  });
});
