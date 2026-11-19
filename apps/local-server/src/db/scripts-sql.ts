import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

/** Pasta dos scripts do banco local (database/local na raiz do repositório). */
export const PASTA_SCRIPTS_LOCAL = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../database/local',
);

/**
 * Divide um arquivo .sql em comandos, respeitando `DELIMITER` (usado nos
 * triggers), como o cliente `mysql` faz.
 * Trechos com delimitador `;` são enviados inteiros (multipleStatements);
 * trechos com outro delimitador são divididos nele.
 */
export function dividirScriptSql(conteudo: string): string[] {
  const comandos: string[] = [];
  let delimitador = ';';
  let bloco: string[] = [];

  const fecharBloco = () => {
    const texto = bloco.join('\n').trim();
    bloco = [];
    if (!texto) return;
    if (delimitador === ';') {
      comandos.push(texto);
      return;
    }
    for (const parte of texto.split(delimitador)) {
      if (parte.trim()) comandos.push(parte.trim());
    }
  };

  for (const linha of conteudo.replace(/\r\n/g, '\n').split('\n')) {
    const diretiva = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(linha);
    if (diretiva?.[1]) {
      fecharBloco();
      delimitador = diretiva[1];
    } else {
      bloco.push(linha);
    }
  }
  fecharBloco();
  // Remove comandos que são só comentários
  return comandos.filter((c) => c.split('\n').some((l) => l.trim() && !l.trim().startsWith('--')));
}

export interface OpcoesCriacao {
  host: string;
  port: number;
  user: string;
  password: string;
  banco: string;
  /** Apaga o banco antes de criar. NUNCA usar em produção. */
  recriar?: boolean;
  aoAplicar?: (arquivo: string) => void;
}

/** Cria o banco (se não existir) e aplica, em ordem, os scripts NNN_*.sql. */
export async function criarBancoLocal(opcoes: OpcoesCriacao): Promise<string[]> {
  if (!/^[A-Za-z0-9_]+$/.test(opcoes.banco)) throw new Error(`Nome de banco inválido: ${opcoes.banco}`);

  const conexao = await mysql.createConnection({
    host: opcoes.host,
    port: opcoes.port,
    user: opcoes.user,
    password: opcoes.password,
    multipleStatements: true,
    charset: 'UTF8MB4_0900_AI_CI',
  });

  try {
    if (opcoes.recriar) await conexao.query(`DROP DATABASE IF EXISTS \`${opcoes.banco}\``);
    await conexao.query(
      `CREATE DATABASE IF NOT EXISTS \`${opcoes.banco}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    await conexao.query(`USE \`${opcoes.banco}\``);
    await conexao.query("SET time_zone = '+00:00'");

    const [tabelas] = await conexao.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?',
      [opcoes.banco],
    );
    if (Number(tabelas[0]?.total) > 0) {
      throw new Error(
        `O banco "${opcoes.banco}" já possui tabelas. Nada foi alterado. ` +
          'Para recriá-lo do zero (apagando TODOS os dados), use --recriar.',
      );
    }

    const arquivos = (await readdir(PASTA_SCRIPTS_LOCAL)).filter((a) => /^\d{3}_.+\.sql$/.test(a)).sort();
    for (const arquivo of arquivos) {
      const conteudo = await readFile(join(PASTA_SCRIPTS_LOCAL, arquivo), 'utf8');
      for (const comando of dividirScriptSql(conteudo)) await conexao.query(comando);
      opcoes.aoAplicar?.(arquivo);
    }
    return arquivos;
  } finally {
    await conexao.end();
  }
}
