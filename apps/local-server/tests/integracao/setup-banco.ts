import mysql from 'mysql2/promise';

/**
 * Antes dos testes de integração: apaga bancos de teste esquecidos por
 * execuções interrompidas. Cada arquivo cria o seu (banco-por-arquivo.ts).
 * Só toca em bancos cujo nome começa com "estacionamento_teste".
 */
export default async function setup(): Promise<void> {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
  });
  try {
    const [linhas] = await c.query<mysql.RowDataPacket[]>("SHOW DATABASES LIKE 'estacionamento\\_teste%'");
    for (const l of linhas) {
      const nome = String(Object.values(l)[0]);
      if (/^estacionamento_teste[a-z0-9_]*$/.test(nome)) await c.query(`DROP DATABASE \`${nome}\``);
    }
  } finally {
    await c.end();
  }
}
