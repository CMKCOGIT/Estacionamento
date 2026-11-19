import mysql from 'mysql2/promise';
import { afterAll } from 'vitest';
import { migrarBancoLocal } from '../../src/db/scripts-sql.js';

/**
 * Roda antes de CADA arquivo de teste de integração: cria um banco só dele,
 * a partir das migrations, e o apaga no final. Assim nenhum arquivo depende
 * da ordem de execução nem dos dados que outro deixou.
 *
 * (Este arquivo não pode importar config/env nem db/pool: eles leem DB_NAME
 * ao serem carregados, e o nome do banco é definido aqui.)
 */
const conexao = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
};
const banco = `estacionamento_teste_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
process.env.DB_NAME = banco;

await migrarBancoLocal({ ...conexao, banco, recriar: true });

afterAll(async () => {
  const c = await mysql.createConnection(conexao);
  await c.query(`DROP DATABASE IF EXISTS \`${banco}\``);
  await c.end();
});
