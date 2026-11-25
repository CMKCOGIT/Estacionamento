import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { setPriority, tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip, createGzip } from 'node:zlib';
import mysql, { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import { mascararDadosPessoais } from '@estacionamento/shared';
import { appInfo } from '../config/app-info.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { registrarAtividade } from '../db/atividades.js';
import { pool } from '../db/pool.js';
import { migrarBancoLocal } from '../db/scripts-sql.js';
import { manutencao } from '../http/manutencao.js';
import { carregarConfig, configEmCache, limparCacheConfig } from '../modules/configuracoes/preferencias.js';

/** Backup inexistente ou impossível de usar agora (vira 409 na rota). */
export class BackupIndisponivel extends Error {}
import { carregarChave, cifrador, decifrarArquivo, idDaChave } from './cripto.js';

/**
 * Backups do banco MySQL local (docs/BACKUP.md).
 *
 * Criação: `mysqldump --single-transaction` (fotografia consistente do InnoDB
 * SEM travar as tabelas: entradas e saídas continuam normalmente), com
 * prioridade baixa no processador → gzip → AES-256-GCM → arquivo temporário
 * → renomeado só quando completo. Depois: conferência completa do arquivo,
 * segunda cópia (BACKUP_COPIA_DIR) e retenção (7 diários, 4 semanais, 12 mensais).
 */
const PASTA_SERVIDOR = fileURLToPath(new URL('../../', import.meta.url));
const caminho = (p: string) => (isAbsolute(p) ? p : resolve(PASTA_SERVIDOR, p));
export const pastaBackups = () => caminho(env.BACKUP_DIR ?? 'backups');
export const arquivoChave = () => caminho('segredos/backup.chave');
const FIM_DO_DUMP = '-- Dump completed';

export interface Manifesto {
  formato: 1;
  id: string;
  banco: string;
  tipo: TipoBackup;
  criadoEm: string;
  arquivo: string;
  tamanhoBytes: number;
  sha256: string;
  chaveId: string;
  tabelas: number;
  gatilhos: number;
  migracoes: string[];
  mysqlVersao: string | null;
  sistemaVersao: string;
}

export interface RegistroBackup {
  id: string;
  tipo: string;
  status: 'EM_ANDAMENTO' | 'SUCESSO' | 'FALHA';
  iniciadoEm: string;
  concluidoEm: string | null;
  duracaoMs: number | null;
  arquivo: string | null;
  tamanhoBytes: number | null;
  sha256: string | null;
  tabelas: number | null;
  copiaEm: string | null;
  verificadoEm: string | null;
  verificacao: 'OK' | 'CORROMPIDO' | 'AUSENTE' | null;
  restauracaoTestadaEm: string | null;
  removidoEm: string | null;
  erro: string | null;
}

// ------------------------------------------------------------------ ferramentas
/** mysqldump/mysql: MYSQL_BIN_DIR, ou a instalação padrão do MySQL no Windows, ou o PATH. */
export function programaMysql(nome: 'mysqldump' | 'mysql'): string {
  const exe = process.platform === 'win32' ? `${nome}.exe` : nome;
  if (env.MYSQL_BIN_DIR) return join(env.MYSQL_BIN_DIR, exe);
  if (process.platform === 'win32') {
    for (const base of ['C:\\Program Files\\MySQL', 'C:\\Program Files (x86)\\MySQL']) {
      if (!existsSync(base)) continue;
      const versoes = readdirSync(base)
        .filter((d) => /^MySQL Server/i.test(d))
        .sort()
        .reverse();
      for (const v of versoes) {
        const c = join(base, v, 'bin', exe);
        if (existsSync(c)) return c;
      }
    }
  }
  return exe;
}

/** Senha num arquivo temporário (nunca na linha de comando, que outros processos podem ver). */
async function arquivoDeCredenciais(): Promise<string> {
  const p = join(tmpdir(), `est-mysql-${ulid()}.cnf`);
  const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await writeFile(
    p,
    `[client]\nuser="${esc(env.DB_USER)}"\npassword="${esc(env.DB_PASSWORD)}"\nhost="${esc(env.DB_HOST)}"\nport=${env.DB_PORT}\n`,
    { mode: 0o600 },
  );
  return p;
}

function executar(programa: string, args: string[]) {
  const filho = spawn(programa, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    if (filho.pid) setPriority(filho.pid, 10); // não disputa o processador com o atendimento
  } catch {
    // sem permissão para mudar a prioridade: segue normal
  }
  let erro = '';
  filho.stderr.on('data', (d: Buffer) => {
    erro = (erro + d.toString()).slice(-4000);
  });
  const terminou = new Promise<void>((ok, falha) => {
    filho.on('error', (e) =>
      falha(
        new Error(
          (e as NodeJS.ErrnoException).code === 'ENOENT'
            ? `Programa ${programa} não encontrado. Configure MYSQL_BIN_DIR no .env (pasta bin do MySQL).`
            : e.message,
        ),
      ),
    );
    filho.on('close', (codigo) =>
      codigo === 0
        ? ok()
        : falha(
            new Error(
              `${basename(programa)} terminou com erro (código ${codigo}): ${mascararDadosPessoais(
                erro.replace(/.*Using a password.*\n?/g, '').trim(),
              ).slice(0, 800)}`,
            ),
          ),
    );
  });
  return { filho, terminou };
}

/** Observa o SQL que passa: conta tabelas e guarda o fim (para conferir que o dump terminou). */
function observador() {
  let tabelas = 0;
  let gatilhos = 0;
  let resto = '';
  let fim = '';
  const t = new Transform({
    transform(p: Buffer, _e, feito) {
      const texto = resto + p.toString('utf8');
      // Só conta o que termina depois do pedaço repetido do bloco anterior
      // (senão um nome que caiu inteiro no fim do bloco seria contado duas vezes)
      const novos = (re: RegExp) =>
        [...texto.matchAll(re)].filter((m) => m.index + m[0].length > resto.length).length;
      tabelas += novos(/\nCREATE TABLE `/g);
      gatilhos += novos(/\*\/ \/\*!50003 TRIGGER `/g);
      resto = texto.slice(-60);
      fim = (fim + p.toString('utf8')).slice(-300);
      feito(null, p);
    },
  });
  return { t, info: () => ({ tabelas, gatilhos, completo: fim.includes(FIM_DO_DUMP) }) };
}

function hashador() {
  const h = createHash('sha256');
  let bytes = 0;
  const t = new Transform({
    transform(p: Buffer, _e, feito) {
      h.update(p);
      bytes += p.length;
      feito(null, p);
    },
  });
  return { t, fim: () => ({ sha256: h.digest('hex'), bytes }) };
}

const sha256DoArquivo = async (p: string) => {
  const h = createHash('sha256');
  await pipeline(createReadStream(p), h);
  return h.digest('hex');
};

/** Remove DEFINER dos objetos (gatilhos/procedimentos): restaura com qualquer usuário com privilégio. */
function semDefiner() {
  let resto = '';
  return new Transform({
    transform(p: Buffer, _e, feito) {
      const texto = resto + p.toString('utf8');
      const corte = texto.lastIndexOf('\n');
      resto = corte >= 0 ? texto.slice(corte + 1) : texto;
      const linhas = corte >= 0 ? texto.slice(0, corte + 1) : '';
      feito(null, linhas.replace(/DEFINER=`[^`]*`@`[^`]*`\s*/g, ''));
    },
    flush(feito) {
      feito(null, resto.replace(/DEFINER=`[^`]*`@`[^`]*`\s*/g, ''));
    },
  });
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
function lerRegistro(l: RowDataPacket): RegistroBackup {
  return {
    id: String(l.id),
    tipo: String(l.tipo),
    status: l.status,
    iniciadoEm: iso(l.iniciado_em)!,
    concluidoEm: iso(l.concluido_em),
    duracaoMs: l.duracao_ms === null ? null : Number(l.duracao_ms),
    arquivo: (l.arquivo as string | null) ?? null,
    tamanhoBytes: l.tamanho_bytes === null ? null : Number(l.tamanho_bytes),
    sha256: (l.sha256 as string | null) ?? null,
    tabelas: l.tabelas === null ? null : Number(l.tabelas),
    copiaEm: iso(l.copia_em),
    verificadoEm: iso(l.verificado_em),
    verificacao: (l.verificacao as RegistroBackup['verificacao']) ?? null,
    restauracaoTestadaEm: iso(l.restauracao_testada_em),
    removidoEm: iso(l.removido_em),
    erro: (l.erro as string | null) ?? null,
  };
}

let emAndamento: Promise<RegistroBackup> | null = null;
let restaurando = false;
export type TipoBackup = 'AUTOMATICO' | 'MANUAL' | 'PRE_RESTAURACAO';

// ---------------------------------------------------------------------- serviço
export const backupService = {
  /** Faz um backup agora (um por vez; um segundo pedido espera o que está rodando). */
  criar(tipo: TipoBackup, usuarioId: string | null = null): Promise<RegistroBackup> {
    if (emAndamento) return emAndamento;
    emAndamento = criarBackup(tipo, usuarioId).finally(() => {
      emAndamento = null;
    });
    return emAndamento;
  },

  emAndamento: () => emAndamento !== null,

  async listar(limite = 60): Promise<RegistroBackup[]> {
    const [l] = await pool.query<RowDataPacket[]>('SELECT * FROM backups ORDER BY iniciado_em DESC LIMIT ?', [
      limite,
    ]);
    return l.map(lerRegistro);
  },

  /**
   * Conferência completa: o hash do arquivo bate com o registrado, a chave
   * decifra (a tag GCM garante que nada foi alterado), o gzip abre e o SQL
   * termina com a marca de dump completo.
   */
  async verificar(id: string): Promise<RegistroBackup> {
    const [[l]] = await pool.query<RowDataPacket[]>('SELECT * FROM backups WHERE id = ?', [id]);
    if (!l?.arquivo) throw new Error('Backup sem arquivo.');
    const r = await conferirArquivo(join(pastaBackups(), String(l.arquivo)), String(l.sha256));
    await pool.query(
      'UPDATE backups SET verificado_em = NOW(3), verificacao = ?, erro = COALESCE(?, erro) WHERE id = ?',
      [r.resultado, r.erro, id],
    );
    if (r.resultado !== 'OK') {
      logger.error({ backup: l.arquivo, motivo: r.erro }, 'Backup com problema na verificação');
      await registrarAtividade({
        acao: 'backup.verificacao_falhou',
        entidade: 'backups',
        entidadeId: id,
        dados: r,
      });
    }
    return lerRegistro(
      (await pool.query<RowDataPacket[]>('SELECT * FROM backups WHERE id = ?', [id]))[0][0]!,
    );
  },

  /** Confere todos os backups guardados (roda todo dia depois do backup). */
  async verificarTodos(): Promise<{ ok: number; problemas: number }> {
    const [l] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM backups WHERE status = 'SUCESSO' AND removido_em IS NULL ORDER BY iniciado_em DESC",
    );
    let ok = 0;
    let problemas = 0;
    for (const b of l) {
      const r = await this.verificar(String(b.id));
      if (r.verificacao === 'OK') ok++;
      else problemas++;
    }
    return { ok, problemas };
  },

  /**
   * Teste de restauração: restaura o backup num banco temporário, confere as
   * tabelas e as migrações com o manifesto e apaga o banco temporário.
   * Não mexe no banco em uso.
   */
  async testarRestauracao(id: string): Promise<{ ok: boolean; tabelas: number; detalhe: string }> {
    const [[l]] = await pool.query<RowDataPacket[]>('SELECT * FROM backups WHERE id = ?', [id]);
    if (!l?.arquivo) throw new Error('Backup sem arquivo.');
    const manifesto = lerManifesto(String(l.arquivo));
    const banco = `${env.DB_NAME}_teste_restauracao`.slice(0, 64);
    try {
      await restaurarEm(join(pastaBackups(), String(l.arquivo)), banco);
      const [[t]] = await pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'",
        [banco],
      );
      const [m] = await pool.query<RowDataPacket[]>(`SELECT arquivo FROM \`${banco}\`.schema_migracoes`);
      const [[g]] = await pool.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema = ?',
        [banco],
      );
      const tabelas = Number(t?.n ?? 0);
      const gatilhos = Number(g?.n ?? 0);
      const migracoesOk =
        !manifesto ||
        JSON.stringify(m.map((x) => String(x.arquivo)).sort()) ===
          JSON.stringify([...manifesto.migracoes].sort());
      const gatilhosOk = !manifesto?.gatilhos || gatilhos === manifesto.gatilhos;
      const ok = tabelas > 0 && (!manifesto || tabelas === manifesto.tabelas) && migracoesOk && gatilhosOk;
      const detalhe = ok
        ? `${tabelas} tabelas e ${gatilhos} gatilhos restaurados e conferidos`
        : `Esperado ${manifesto?.tabelas} tabelas e ${manifesto?.gatilhos} gatilhos; restaurados ${tabelas} e ${gatilhos}; migrações ${migracoesOk ? 'ok' : 'diferentes'}`;
      if (ok) await pool.query('UPDATE backups SET restauracao_testada_em = NOW(3) WHERE id = ?', [id]);
      await registrarAtividade({
        acao: ok ? 'backup.restauracao_testada' : 'backup.restauracao_falhou',
        entidade: 'backups',
        entidadeId: id,
        dados: { tabelas, detalhe },
      });
      return { ok, tabelas, detalhe };
    } finally {
      await pool.query(`DROP DATABASE IF EXISTS \`${banco}\``).catch(() => undefined);
    }
  },

  /** Retenção: últimos N diários, N semanais (domingo) e N mensais; o resto é apagado. */
  async aplicarRetencao(): Promise<number> {
    const [l] = await pool.query<RowDataPacket[]>(
      "SELECT id, tipo, arquivo, iniciado_em FROM backups WHERE status = 'SUCESSO' AND removido_em IS NULL ORDER BY iniciado_em DESC",
    );
    const manter = new Set<string>();
    // Backups de segurança de restaurações ficam 30 dias (servem para desfazer)
    for (const b of l)
      if (b.tipo === 'PRE_RESTAURACAO' && Date.now() - (b.iniciado_em as Date).getTime() < 30 * 86_400_000)
        manter.add(String(b.id));
    const escolher = (chave: (d: Date) => string, quantos: number) => {
      const vistos = new Set<string>();
      for (const b of l) {
        const k = chave(b.iniciado_em as Date);
        if (vistos.has(k)) continue;
        vistos.add(k);
        if (vistos.size > quantos) break;
        manter.add(String(b.id));
      }
    };
    const local = (d: Date) => new Date(d.getTime() + desvioFusoMs());
    escolher((d) => local(d).toISOString().slice(0, 10), env.BACKUP_RETER_DIARIOS);
    escolher((d) => semanaIso(local(d)), env.BACKUP_RETER_SEMANAIS);
    escolher((d) => local(d).toISOString().slice(0, 7), env.BACKUP_RETER_MENSAIS);
    if (l[0]) manter.add(String(l[0].id)); // o mais recente sempre fica
    let removidos = 0;
    for (const b of l) {
      if (manter.has(String(b.id))) continue;
      for (const pasta of [
        pastaBackups(),
        ...(env.BACKUP_COPIA_DIR ? [caminho(env.BACKUP_COPIA_DIR)] : []),
      ]) {
        await unlink(join(pasta, String(b.arquivo))).catch(() => undefined);
        await unlink(join(pasta, `${String(b.arquivo)}.json`)).catch(() => undefined);
      }
      await pool.query('UPDATE backups SET removido_em = NOW(3) WHERE id = ?', [b.id]);
      removidos++;
    }
    // Registros de falhas antigas também saem (90 dias)
    await pool.query("DELETE FROM backups WHERE status = 'FALHA' AND iniciado_em < NOW(3) - INTERVAL 90 DAY");
    return removidos;
  },

  /** Depois de restaurar um banco antigo: registra no histórico os backups que estão na pasta. */
  async sincronizarHistorico(): Promise<number> {
    const pasta = pastaBackups();
    if (!existsSync(pasta)) return 0;
    let n = 0;
    for (const f of readdirSync(pasta).filter((x) => x.endsWith('.sql.gz.enc.json'))) {
      let m: Manifesto;
      try {
        m = JSON.parse(readFileSync(join(pasta, f), 'utf8')) as Manifesto;
      } catch {
        continue; // manifesto ilegível: o arquivo não é listado, mas nada quebra
      }
      if (!m?.id || !m.arquivo || !existsSync(join(pasta, m.arquivo))) continue;
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT IGNORE INTO backups (id, tipo, status, iniciado_em, concluido_em, arquivo, tamanho_bytes, sha256, chave_id, tabelas)
         VALUES (?, ?, 'SUCESSO', ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.id,
          m.tipo,
          new Date(m.criadoEm),
          new Date(m.criadoEm),
          m.arquivo,
          m.tamanhoBytes,
          m.sha256,
          m.chaveId,
          m.tabelas,
        ],
      );
      n += r.affectedRows;
    }
    return n;
  },

  /** Caminho do arquivo para download (o arquivo continua cifrado: só abre com a chave). */
  async arquivoParaDownload(id: string): Promise<{ caminho: string; nome: string; bytes: number }> {
    const [[l]] = await pool.query<RowDataPacket[]>(
      "SELECT arquivo, tamanho_bytes FROM backups WHERE id = ? AND status = 'SUCESSO' AND removido_em IS NULL",
      [id],
    );
    if (!l?.arquivo) throw new BackupIndisponivel('Backup não encontrado ou já removido pela retenção.');
    const p = join(pastaBackups(), String(l.arquivo));
    if (!existsSync(p)) throw new BackupIndisponivel('O arquivo deste backup não está mais na pasta.');
    return { caminho: p, nome: String(l.arquivo), bytes: Number(l.tamanho_bytes ?? 0) };
  },

  restaurando: () => restaurando,

  /**
   * Restaura um backup NO BANCO EM USO, pelo painel:
   *  1. confere a integridade do arquivo (hash, chave, gzip e fim do dump);
   *  2. liga o modo manutenção (a API responde 503 para todos);
   *  3. faz um backup de segurança do estado atual (para desfazer);
   *  4. recria o banco com o conteúdo do backup e aplica as migrations novas;
   *  5. marca a sincronização para reenviar tudo e registra no histórico.
   * Quem pede precisa ter confirmado a própria senha (na rota).
   */
  async restaurarNoBancoAtual(
    id: string,
    usuarioId: string,
    meta: { ip: string | null },
  ): Promise<{ arquivo: string; backupSeguranca: string; tabelas: number; migracoes: string[] }> {
    if (restaurando) throw new BackupIndisponivel('Já há uma restauração em andamento.');
    if (emAndamento)
      throw new BackupIndisponivel('Há um backup em andamento. Espere terminar e tente de novo.');
    const [[l]] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM backups WHERE id = ? AND status = 'SUCESSO' AND removido_em IS NULL",
      [id],
    );
    if (!l) throw new BackupIndisponivel('Backup não encontrado ou já removido pela retenção.');
    const registro = lerRegistro(l);
    const conferido = await this.verificar(id);
    if (conferido.verificacao !== 'OK') {
      throw new BackupIndisponivel(
        `Este backup não passou na conferência de integridade (${conferido.erro ?? conferido.verificacao}). Escolha outro.`,
      );
    }
    restaurando = true;
    manutencao.ativar('O sistema está restaurando um backup.');
    try {
      // Dá tempo para as requisições que já estavam em andamento terminarem
      await new Promise((r) => setTimeout(r, 1500));
      const seguranca = await criarBackup('PRE_RESTAURACAO', usuarioId);
      if (seguranca.status !== 'SUCESSO' || !seguranca.arquivo) {
        throw new Error(
          `O backup de segurança falhou (${seguranca.erro ?? 'erro desconhecido'}). Nada foi alterado.`,
        );
      }
      await restaurarEm(join(pastaBackups(), registro.arquivo!), env.DB_NAME);
      // Backup de uma versão anterior do sistema: aplica as migrations que faltam
      const migracao = await migrarBancoLocal({
        host: env.DB_HOST,
        port: env.DB_PORT,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        banco: env.DB_NAME,
      });
      await pool.query('UPDATE sync_estado SET snapshot_pendente = TRUE, conferencia_pendente = TRUE');
      // Os registros de backup do banco restaurado são antigos: relê os manifestos da pasta
      await this.sincronizarHistorico().catch((e: unknown) =>
        logger.warn({ err: e }, 'Restauração feita, mas a lista de backups não foi relida'),
      );
      const [[t]] = await pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
      );
      const tabelas = Number(t?.n ?? 0);
      const [[u]] = await pool.query<RowDataPacket[]>('SELECT id FROM usuarios WHERE id = ?', [usuarioId]);
      await pool.query(
        'INSERT INTO backup_restauracoes (id, arquivo, backup_seguranca, restaurado_por, tabelas) VALUES (?, ?, ?, ?, ?)',
        [ulid(), registro.arquivo, seguranca.arquivo, u ? usuarioId : null, tabelas],
      );
      const site = await pool.query<RowDataPacket[]>('SELECT id FROM sites LIMIT 1');
      await registrarAtividade({
        acao: 'backup.restaurado',
        siteId: (site[0][0]?.id as string | undefined) ?? null,
        usuarioId: u ? usuarioId : null,
        entidade: 'backups',
        entidadeId: id,
        ip: meta.ip,
        dados: {
          arquivo: registro.arquivo,
          criadoEm: registro.iniciadoEm,
          backupSeguranca: seguranca.arquivo,
          migracoesAplicadas: migracao.aplicadas,
        },
      });
      limparCacheConfig();
      logger.warn(
        { arquivo: registro.arquivo, seguranca: seguranca.arquivo },
        'Backup restaurado pelo painel',
      );
      return {
        arquivo: registro.arquivo!,
        backupSeguranca: seguranca.arquivo,
        tabelas,
        migracoes: migracao.aplicadas,
      };
    } finally {
      manutencao.desativar();
      restaurando = false;
    }
  },

  async situacao() {
    const [[ultimo]] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM backups WHERE status = 'SUCESSO' ORDER BY iniciado_em DESC LIMIT 1",
    );
    const [[falha]] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM backups WHERE status = 'FALHA' ORDER BY iniciado_em DESC LIMIT 1",
    );
    const [[problemas]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM backups WHERE status = 'SUCESSO' AND removido_em IS NULL AND verificacao IN ('CORROMPIDO','AUSENTE')",
    );
    const [[guardados]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n, COALESCE(SUM(tamanho_bytes), 0) AS bytes FROM backups WHERE status = 'SUCESSO' AND removido_em IS NULL",
    );
    const { chave } = carregarChave(env.BACKUP_CHAVE, arquivoChave());
    const { backup: agenda } = await carregarConfig();
    const [[restauracao]] = await pool.query<RowDataPacket[]>(
      `SELECT r.arquivo, r.backup_seguranca, r.restaurado_em, COALESCE(f.nome, u.login) AS nome
         FROM backup_restauracoes r
         LEFT JOIN usuarios u ON u.id = r.restaurado_por
         LEFT JOIN funcionarios f ON f.usuario_id = u.id
        ORDER BY r.restaurado_em DESC LIMIT 1`,
    );
    return {
      ativo: agenda.ativo,
      pasta: pastaBackups(),
      copia: env.BACKUP_COPIA_DIR ? caminho(env.BACKUP_COPIA_DIR) : null,
      horario: agenda.horario,
      proximoEm: proximoHorario(new Date(), agenda.horario).toISOString(),
      ultimaRestauracao: restauracao
        ? {
            arquivo: String(restauracao.arquivo),
            backupSeguranca: (restauracao.backup_seguranca as string | null) ?? null,
            em: (restauracao.restaurado_em as Date).toISOString(),
            por: (restauracao.nome as string | null) ?? null,
          }
        : null,
      chaveId: idDaChave(chave),
      chaveNoArquivo: !env.BACKUP_CHAVE,
      retencao: {
        diarios: env.BACKUP_RETER_DIARIOS,
        semanais: env.BACKUP_RETER_SEMANAIS,
        mensais: env.BACKUP_RETER_MENSAIS,
      },
      emAndamento: emAndamento !== null,
      ultimoSucesso: ultimo ? lerRegistro(ultimo) : null,
      ultimaFalha: falha ? lerRegistro(falha) : null,
      guardados: Number(guardados?.n ?? 0),
      bytesGuardados: Number(guardados?.bytes ?? 0),
      comProblema: Number(problemas?.n ?? 0),
    };
  },
};

// ------------------------------------------------------------------- internos
async function criarBackup(tipo: TipoBackup, usuarioId: string | null): Promise<RegistroBackup> {
  const id = ulid();
  const inicio = new Date();
  const pasta = pastaBackups();
  const carimbo = new Date(inicio.getTime() + desvioFusoMs())
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15);
  const sufixo = { MANUAL: 'manual', AUTOMATICO: 'auto', PRE_RESTAURACAO: 'antes-restauracao' }[tipo];
  const arquivo = `backup-${carimbo}-${sufixo}.sql.gz.enc`;
  const final = join(pasta, arquivo);
  const parcial = `${final}.parcial`;
  let cred: string | null = null;
  await pool.query(
    "INSERT INTO backups (id, tipo, status, iniciado_em, solicitado_por) VALUES (?, ?, 'EM_ANDAMENTO', ?, ?)",
    [id, tipo, inicio, usuarioId],
  );
  try {
    await mkdir(pasta, { recursive: true });
    const { chave } = carregarChave(env.BACKUP_CHAVE, arquivoChave());
    cred = await arquivoDeCredenciais();
    const [migs] = await pool.query<RowDataPacket[]>('SELECT arquivo FROM schema_migracoes ORDER BY arquivo');
    const [[ver]] = await pool.query<RowDataPacket[]>('SELECT VERSION() AS v');

    const { filho, terminou } = executar(programaMysql('mysqldump'), [
      `--defaults-extra-file=${cred}`,
      '--single-transaction', // fotografia consistente, sem travar as tabelas
      '--quick', // linha a linha, sem carregar tabelas inteiras na memória
      '--routines',
      '--triggers',
      '--events',
      '--hex-blob',
      '--no-tablespaces',
      '--set-gtid-purged=OFF',
      '--default-character-set=utf8mb4',
      env.DB_NAME,
    ]);
    filho.stdin.end();
    const obs = observador();
    const hash = hashador();
    await Promise.all([
      pipeline(
        filho.stdout,
        obs.t,
        createGzip({ level: 6 }),
        cifrador(chave),
        hash.t,
        createWriteStream(parcial, { mode: 0o600 }),
      ),
      terminou,
    ]);
    const info = obs.info();
    if (!info.completo) throw new Error('O mysqldump terminou sem a marca de dump completo.');
    const h = hash.fim();
    await rename(parcial, final);

    const manifesto: Manifesto = {
      formato: 1,
      id,
      banco: env.DB_NAME,
      tipo,
      criadoEm: inicio.toISOString(),
      arquivo,
      tamanhoBytes: h.bytes,
      sha256: h.sha256,
      chaveId: idDaChave(chave),
      tabelas: info.tabelas,
      gatilhos: info.gatilhos,
      migracoes: migs.map((m) => String(m.arquivo)),
      mysqlVersao: ver ? String(ver.v) : null,
      sistemaVersao: appInfo.versao,
    };
    await writeFile(`${final}.json`, JSON.stringify(manifesto, null, 2));

    // Conferência completa do que acabou de ser gravado
    const conf = await conferirArquivo(final, h.sha256);
    if (conf.resultado !== 'OK') throw new Error(`O backup gravado não passou na conferência: ${conf.erro}`);

    // Segunda cópia (outro disco/computador), conferida pelo hash
    let copiaEm: Date | null = null;
    if (env.BACKUP_COPIA_DIR) {
      try {
        const destino = caminho(env.BACKUP_COPIA_DIR);
        await mkdir(destino, { recursive: true });
        await copyFile(final, join(destino, arquivo));
        await copyFile(`${final}.json`, join(destino, `${arquivo}.json`));
        if ((await sha256DoArquivo(join(destino, arquivo))) !== h.sha256)
          throw new Error('cópia diferente do original');
        copiaEm = new Date();
      } catch (e) {
        logger.error({ err: e }, 'Backup feito, mas a segunda cópia (BACKUP_COPIA_DIR) falhou');
        await registrarAtividade({
          acao: 'backup.copia_falhou',
          entidade: 'backups',
          entidadeId: id,
          dados: { erro: (e as Error).message },
        });
      }
    }

    await pool.query(
      `UPDATE backups SET status = 'SUCESSO', concluido_em = NOW(3), duracao_ms = ?, arquivo = ?, tamanho_bytes = ?, sha256 = ?,
         chave_id = ?, tabelas = ?, copia_em = ?, verificado_em = NOW(3), verificacao = 'OK' WHERE id = ?`,
      [
        Date.now() - inicio.getTime(),
        arquivo,
        h.bytes,
        h.sha256,
        manifesto.chaveId,
        info.tabelas,
        copiaEm,
        id,
      ],
    );
    await registrarAtividade({
      acao: 'backup.criado',
      usuarioId,
      entidade: 'backups',
      entidadeId: id,
      dados: { tipo, arquivo, tamanhoBytes: h.bytes, tabelas: info.tabelas, copia: Boolean(copiaEm) },
    });
    logger.info({ arquivo, bytes: h.bytes, ms: Date.now() - inicio.getTime() }, 'Backup do banco concluído');
    // O backup de segurança da restauração não aplica a retenção: ela poderia
    // apagar justamente o backup (do mesmo dia) que vai ser restaurado
    if (tipo !== 'PRE_RESTAURACAO')
      await backupService
        .aplicarRetencao()
        .catch((e: unknown) => logger.warn({ err: e }, 'Falha na retenção de backups'));
  } catch (e) {
    const erro = mascararDadosPessoais((e as Error).message).slice(0, 1000);
    await unlink(parcial).catch(() => undefined);
    logger.error({ erro }, 'Backup do banco FALHOU');
    await pool
      .query(
        "UPDATE backups SET status = 'FALHA', concluido_em = NOW(3), duracao_ms = ?, erro = ? WHERE id = ?",
        [Date.now() - inicio.getTime(), erro, id],
      )
      .catch(() => undefined);
    await registrarAtividade({
      acao: 'backup.falhou',
      usuarioId,
      entidade: 'backups',
      entidadeId: id,
      dados: { erro },
    }).catch(() => undefined);
  } finally {
    if (cred) await rm(cred, { force: true });
  }
  return lerRegistro((await pool.query<RowDataPacket[]>('SELECT * FROM backups WHERE id = ?', [id]))[0][0]!);
}

async function conferirArquivo(
  arquivo: string,
  sha256: string,
): Promise<{ resultado: 'OK' | 'CORROMPIDO' | 'AUSENTE'; erro: string | null }> {
  if (!existsSync(arquivo))
    return { resultado: 'AUSENTE', erro: 'Arquivo não encontrado na pasta de backups.' };
  try {
    if ((await sha256DoArquivo(arquivo)) !== sha256)
      return { resultado: 'CORROMPIDO', erro: 'O arquivo mudou depois de gravado (hash diferente).' };
    const { chave } = carregarChave(env.BACKUP_CHAVE, arquivoChave());
    const obs = observador();
    await pipeline(
      await decifrarArquivo(arquivo, chave),
      createGunzip(),
      obs.t,
      new Writable({ write: (_p, _e, feito) => feito() }),
    );
    if (!obs.info().completo) return { resultado: 'CORROMPIDO', erro: 'O SQL do backup está incompleto.' };
    return { resultado: 'OK', erro: null };
  } catch (e) {
    const m = (e as Error).message;
    return {
      resultado: 'CORROMPIDO',
      erro: /auth|authenticate/i.test(m)
        ? 'Não foi possível decifrar: arquivo alterado ou chave diferente da usada no backup.'
        : m.slice(0, 300),
    };
  }
}

function lerManifesto(arquivo: string): Manifesto | null {
  const p = join(pastaBackups(), `${arquivo}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Manifesto) : null;
}

/** Restaura um arquivo de backup num banco (que é recriado do zero). */
export async function restaurarEm(arquivo: string, banco: string): Promise<void> {
  if (!/^[A-Za-z0-9_]+$/.test(banco)) throw new Error(`Nome de banco inválido: ${banco}`);
  const { chave } = carregarChave(env.BACKUP_CHAVE, arquivoChave());
  // Conexão própria, sem banco padrão: as conexões do pool continuam apontando
  // para o nome do banco e voltam a funcionar quando ele é recriado
  const admin = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  });
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${banco}\``);
    await admin.query(`CREATE DATABASE \`${banco}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  } finally {
    await admin.end();
  }
  const cred = await arquivoDeCredenciais();
  try {
    const { filho, terminou } = executar(programaMysql('mysql'), [
      `--defaults-extra-file=${cred}`,
      '--default-character-set=utf8mb4',
      banco,
    ]);
    filho.stdout.resume();
    await Promise.all([
      pipeline(await decifrarArquivo(arquivo, chave), createGunzip(), semDefiner(), filho.stdin),
      terminou,
    ]);
  } finally {
    await rm(cred, { force: true });
  }
}

// ---------------------------------------------------------------- agendamento
function desvioFusoMs(): number {
  const [, sinal, h, m] = /^([+-])(\d{2}):(\d{2})$/.exec(env.FUSO_OFFSET)!;
  return (sinal === '-' ? -1 : 1) * (Number(h) * 60 + Number(m)) * 60_000;
}

function semanaIso(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const ano = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-S${Math.ceil(((t.getTime() - ano.getTime()) / 86_400_000 + 1) / 7)}`;
}

/** Próximo horário do backup automático (BACKUP_HORA no fuso do estacionamento). */
export function proximoHorario(agora = new Date(), horario = configEmCache().backup.horario): Date {
  const [h, m] = horario.split(':').map(Number) as [number, number];
  const local = new Date(agora.getTime() + desvioFusoMs());
  const alvo =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, m) - desvioFusoMs();
  return new Date(alvo > agora.getTime() ? alvo : alvo + 86_400_000);
}

/**
 * Agenda: backup automático todo dia no BACKUP_HORA (e logo ao iniciar, se
 * o último sucesso tiver mais de 26 h); depois do backup, confere todos os
 * guardados; uma vez por mês, testa a restauração do mais recente.
 */
export function iniciarAgendadorBackup(): void {
  if (!env.BACKUP_ATIVO) logger.warn('Backup automático DESLIGADO no .env (BACKUP_ATIVO=false).');
  const rodar = async () => {
    try {
      const r = await backupService.criar('AUTOMATICO');
      if (r.status !== 'SUCESSO') return;
      await backupService.verificarTodos();
      const [[t]] = await pool.query<RowDataPacket[]>(
        "SELECT MAX(restauracao_testada_em) AS t FROM backups WHERE status = 'SUCESSO'",
      );
      if (!t?.t || Date.now() - (t.t as Date).getTime() > 30 * 86_400_000)
        await backupService.testarRestauracao(r.id);
    } catch (e) {
      logger.error({ err: e }, 'Falha na rotina de backup');
    }
  };
  // O horário e o liga/desliga vêm de Configurações → Backup (ou do .env, se nunca salvos)
  let horario = configEmCache().backup.horario;
  let proximo = proximoHorario(new Date(), horario);
  setInterval(() => {
    void carregarConfig()
      .then(({ backup }) => {
        if (backup.horario !== horario) {
          horario = backup.horario;
          proximo = proximoHorario(new Date(), horario);
        }
        if (Date.now() >= proximo.getTime()) {
          proximo = proximoHorario(new Date(Date.now() + 60_000), horario);
          if (backup.ativo) void rodar();
        }
      })
      .catch(() => undefined);
  }, 30_000).unref();
  // Ao iniciar: se o último backup bom for antigo (PC desligado no horário), faz um em 2 minutos
  setTimeout(() => {
    void backupService
      .sincronizarHistorico()
      .then(() =>
        pool.query<RowDataPacket[]>("SELECT MAX(iniciado_em) AS t FROM backups WHERE status = 'SUCESSO'"),
      )
      .then(([[u]]) => {
        if (configEmCache().backup.ativo && (!u?.t || Date.now() - (u.t as Date).getTime() > 26 * 3_600_000))
          void rodar();
      })
      .catch((e: unknown) => logger.warn({ err: e }, 'Não foi possível conferir o último backup'));
  }, 2 * 60_000).unref();
  logger.info({ horario, pasta: pastaBackups() }, 'Backup automático agendado');
}
