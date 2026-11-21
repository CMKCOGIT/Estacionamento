import mysql from 'mysql2/promise';
import { env } from '../src/config/env.js';
import { migrarBancoNuvem } from '../src/db/migrar.js';

/** --recriar: apaga e recria o banco (só fora de produção; usado pela demonstração). */
if (process.argv.includes('--recriar')) {
  if (env.NODE_ENV === 'production') throw new Error('--recriar não é permitido em produção.');
  if (!/^[A-Za-z0-9_]+$/.test(env.DB_NAME)) throw new Error(`Nome de banco inválido: ${env.DB_NAME}`);
  const c = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  });
  await c.query(`DROP DATABASE IF EXISTS \`${env.DB_NAME}\``);
  await c.end();
}

const aplicados = await migrarBancoNuvem({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  banco: env.DB_NAME,
});
console.log(
  aplicados.length
    ? `Banco da nuvem atualizado: ${aplicados.join(', ')}`
    : 'Banco da nuvem já estava atualizado.',
);
