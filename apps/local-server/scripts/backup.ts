/**
 * Backups pela linha de comando (também usados pelos .cmd):
 *
 *   npm run backup -w @estacionamento/local-server -- criar
 *   npm run backup -w @estacionamento/local-server -- listar
 *   npm run backup -w @estacionamento/local-server -- verificar
 *   npm run backup -w @estacionamento/local-server -- restaurar --arquivo <nome> [--banco <destino>] --confirmar
 *
 * "restaurar" APAGA e recria o banco de destino (padrão: DB_NAME do .env)
 * com o conteúdo do backup. Pare o servidor (Iniciar.cmd) antes de
 * restaurar o banco em uso. Veja docs/BACKUP.md.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { RowDataPacket } from 'mysql2/promise';
import { join } from 'node:path';
import { backupService, pastaBackups, restaurarEm, type Manifesto } from '../src/backup/backup.service.js';
import { env } from '../src/config/env.js';
import { fecharPool, pool } from '../src/db/pool.js';

const [acao, ...resto] = process.argv.slice(2);
const opcao = (n: string) => {
  const i = resto.indexOf(`--${n}`);
  return i >= 0 ? resto[i + 1] : undefined;
};
const mb = (b: number) => `${(b / 1_048_576).toFixed(1)} MB`;

function manifestos(): Manifesto[] {
  const pasta = pastaBackups();
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta)
    .filter((f) => f.endsWith('.sql.gz.enc.json'))
    .map((f) => JSON.parse(readFileSync(join(pasta, f), 'utf8')) as Manifesto)
    .filter((m) => existsSync(join(pasta, m.arquivo)))
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

async function principal() {
  switch (acao) {
    case 'criar': {
      const r = await backupService.criar('MANUAL');
      if (r.status !== 'SUCESSO') throw new Error(`Backup falhou: ${r.erro}`);
      console.log(
        `Backup criado: ${r.arquivo} (${mb(r.tamanhoBytes ?? 0)}, ${r.tabelas} tabelas, conferido).`,
      );
      return;
    }
    case 'listar': {
      // Lê a PASTA (funciona mesmo com o banco perdido)
      const l = manifestos();
      if (!l.length) console.log(`Nenhum backup em ${pastaBackups()}`);
      for (const m of l)
        console.log(
          `${m.arquivo}  ${new Date(m.criadoEm).toLocaleString('pt-BR')}  ${mb(m.tamanhoBytes)}  ${m.tabelas} tabelas`,
        );
      return;
    }
    case 'verificar': {
      await backupService.sincronizarHistorico();
      const r = await backupService.verificarTodos();
      console.log(`Conferidos: ${r.ok} bons, ${r.problemas} com problema.`);
      if (r.problemas) process.exitCode = 2;
      return;
    }
    case 'restaurar': {
      const nome = opcao('arquivo') ?? manifestos()[0]?.arquivo;
      if (!nome) throw new Error('Nenhum backup encontrado.');
      const arquivo = join(pastaBackups(), nome);
      if (!existsSync(arquivo)) throw new Error(`Arquivo não encontrado: ${arquivo}`);
      const banco = opcao('banco') ?? env.DB_NAME;
      if (!resto.includes('--confirmar')) {
        console.log(`Isto vai APAGAR o banco "${banco}" e colocar no lugar o conteúdo de ${nome}.`);
        console.log('Pare o servidor antes. Para seguir, repita o comando com --confirmar');
        process.exitCode = 1;
        return;
      }
      console.log(`Restaurando ${nome} em "${banco}"... (pode levar alguns minutos)`);
      await restaurarEm(arquivo, banco);
      // A nuvem pode ter dados mais novos que o backup: o servidor local (fonte da verdade) reenvia tudo
      await pool.query(
        `UPDATE \`${banco}\`.sync_estado SET snapshot_pendente = TRUE, conferencia_pendente = TRUE`,
      );
      const [[t]] = await pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'",
        [banco],
      );
      console.log(`Pronto: ${t?.n} tabelas restauradas. Inicie o servidor (Iniciar.cmd).`);
      console.log('A sincronização vai reenviar o estado completo para a nuvem automaticamente.');
      return;
    }
    default:
      console.log(
        'Uso: backup criar | listar | verificar | restaurar --arquivo <nome> [--banco <destino>] --confirmar',
      );
  }
}

try {
  await principal();
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await fecharPool();
}
