import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

/** Pasta dos scripts do banco local (database/local na raiz do repositório). */
export const PASTA_SCRIPTS_LOCAL = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../database/local',
);

/** Scripts que formam a versão inicial (já aplicados manualmente em bancos antigos). */
const VERSAO_INICIAL = ['001_schema.sql', '002_triggers.sql', '003_views.sql', '004_seed.sql'];

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

/** Checksum independente de CRLF/LF (o mesmo arquivo no Windows e no Linux). */
export function checksumScript(conteudo: string): string {
  return createHash('sha256').update(conteudo.replace(/\r\n/g, '\n')).digest('hex');
}

export interface OpcoesMigracao {
  host: string;
  port: number;
  user: string;
  password: string;
  banco: string;
  /** Apaga o banco antes de criar. NUNCA usar em produção. */
  recriar?: boolean;
  pasta?: string;
  aoAplicar?: (arquivo: string) => void;
  aoAviso?: (mensagem: string) => void;
}

export interface ResultadoMigracao {
  aplicadas: string[];
  jaAplicadas: number;
  baseline: boolean;
}

/**
 * Cria o banco (se não existir) e aplica, em ordem, os scripts NNN_*.sql que
 * ainda não foram aplicados, registrando cada um em `schema_migracoes`.
 *
 * Bancos criados antes do controle de migrations (scripts 001–004 rodados à
 * mão) são reconhecidos: as 4 primeiras são registradas como já aplicadas
 * ("baseline") e só as novas são executadas.
 *
 * Atenção: no MySQL, comandos DDL (CREATE/ALTER) não podem ser desfeitos por
 * ROLLBACK. Se uma migration falhar no meio, corrija a causa e trate o estado
 * parcial antes de rodar de novo. Por isso cada migration deve ser pequena.
 */
export async function migrarBancoLocal(opcoes: OpcoesMigracao): Promise<ResultadoMigracao> {
  if (!/^[A-Za-z0-9_]+$/.test(opcoes.banco)) throw new Error(`Nome de banco inválido: ${opcoes.banco}`);
  const pasta = opcoes.pasta ?? PASTA_SCRIPTS_LOCAL;

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

    const arquivos = (await readdir(pasta)).filter((a) => /^\d{3}_.+\.sql$/.test(a)).sort();
    const conteudos = new Map<string, string>();
    for (const a of arquivos) conteudos.set(a, await readFile(join(pasta, a), 'utf8'));

    // Controle de migrations
    const [existeControle] = await conexao.query<mysql.RowDataPacket[]>(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = 'schema_migracoes'",
      [opcoes.banco],
    );
    let baseline = false;
    if (existeControle.length === 0) {
      await conexao.query(`
        CREATE TABLE schema_migracoes (
          arquivo     VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          checksum    CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
          aplicado_em DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          duracao_ms  INT UNSIGNED NOT NULL DEFAULT 0,
          baseline    BOOLEAN      NOT NULL DEFAULT FALSE,
          PRIMARY KEY (arquivo)
        ) ENGINE=InnoDB COMMENT='Migrations aplicadas (gerenciado por db:migrar)'`);

      // Banco antigo, com a versão inicial aplicada à mão?
      const [legado] = await conexao.query<mysql.RowDataPacket[]>(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = 'sites'",
        [opcoes.banco],
      );
      if (legado.length > 0) {
        baseline = true;
        for (const a of VERSAO_INICIAL.filter((x) => conteudos.has(x))) {
          await conexao.query(
            'INSERT INTO schema_migracoes (arquivo, checksum, baseline) VALUES (?, ?, TRUE)',
            [a, checksumScript(conteudos.get(a) ?? '')],
          );
        }
      }
    }

    const [registradas] = await conexao.query<mysql.RowDataPacket[]>(
      'SELECT arquivo, checksum FROM schema_migracoes',
    );
    const aplicadasAntes = new Map(registradas.map((r) => [String(r.arquivo), String(r.checksum)]));

    const aplicadas: string[] = [];
    for (const arquivo of arquivos) {
      const conteudo = conteudos.get(arquivo) ?? '';
      const checksum = checksumScript(conteudo);
      const anterior = aplicadasAntes.get(arquivo);
      if (anterior) {
        if (anterior !== checksum) {
          opcoes.aoAviso?.(
            `${arquivo} foi alterado depois de aplicado. Migrations aplicadas não devem ser editadas; crie uma nova.`,
          );
        }
        continue;
      }
      const inicio = Date.now();
      for (const comando of dividirScriptSql(conteudo)) await conexao.query(comando);
      await conexao.query('INSERT INTO schema_migracoes (arquivo, checksum, duracao_ms) VALUES (?, ?, ?)', [
        arquivo,
        checksum,
        Date.now() - inicio,
      ]);
      aplicadas.push(arquivo);
      opcoes.aoAplicar?.(arquivo);
    }
    return { aplicadas, jaAplicadas: aplicadasAntes.size, baseline };
  } finally {
    await conexao.end();
  }
}
