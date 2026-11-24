import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

/** Pasta dos scripts do banco da nuvem (database/cloud/NNN_*.sql). */
export const PASTA_SQL_NUVEM = fileURLToPath(new URL('../../../../database/cloud/', import.meta.url));

/**
 * Cria o banco (se preciso) e aplica, em ordem, os scripts ainda não
 * aplicados, registrando cada um em `schema_migracoes`. Os scripts da nuvem
 * não usam triggers, então basta separar os comandos por ";".
 */
export async function migrarBancoNuvem(o: {
  host: string;
  port: number;
  user: string;
  password: string;
  banco: string;
  pasta?: string;
  ssl?: { ca?: string; rejectUnauthorized: true };
}): Promise<string[]> {
  if (!/^[A-Za-z0-9_]+$/.test(o.banco)) throw new Error(`Nome de banco inválido: ${o.banco}`);
  const c = await mysql.createConnection({
    host: o.host,
    port: o.port,
    user: o.user,
    password: o.password,
    ssl: o.ssl,
    multipleStatements: false,
  });
  try {
    await c.query(
      `CREATE DATABASE IF NOT EXISTS \`${o.banco}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    await c.query(`USE \`${o.banco}\``);
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migracoes (
      arquivo VARCHAR(120) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL,
      aplicado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
    const [feitos] = await c.query<mysql.RowDataPacket[]>('SELECT arquivo FROM schema_migracoes');
    const ja = new Set(feitos.map((f) => String(f.arquivo)));
    const pasta = o.pasta ?? PASTA_SQL_NUVEM;
    const arquivos = (await readdir(pasta)).filter((a) => /^\d{3}_.+\.sql$/.test(a)).sort();
    const aplicados: string[] = [];
    for (const arquivo of arquivos.filter((a) => !ja.has(a))) {
      const sql = await readFile(`${pasta}${arquivo}`, 'utf8');
      const comandos = sql
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const comando of comandos) await c.query(comando);
      await c.query('INSERT INTO schema_migracoes (arquivo, checksum) VALUES (?, ?)', [
        arquivo,
        createHash('sha256').update(sql).digest('hex'),
      ]);
      aplicados.push(arquivo);
    }
    return aplicados;
  } finally {
    await c.end();
  }
}
