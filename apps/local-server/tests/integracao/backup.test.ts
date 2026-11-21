import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backupService, pastaBackups, programaMysql } from '../../src/backup/backup.service.js';
import { criarApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { criarCadastrosBase, type CadastrosBase } from '../../src/modules/demonstracao/cenario.js';
import { ADMIN, criarUsuario, entrar, garantirAdmin } from './ajuda.js';

/** Precisa do mysqldump/mysql (MYSQL_BIN_DIR ou PATH). Sem eles, os testes são pulados. */
const temMysqldump = spawnSync(programaMysql('mysqldump'), ['--version']).status === 0;
const app = criarApp();
let admin: Awaited<ReturnType<typeof entrar>>;
let base: CadastrosBase;

beforeAll(async () => {
  rmSync(pastaBackups(), { recursive: true, force: true });
  const { siteId, usuarioId } = await garantirAdmin();
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  await comTransacao({ usuarioId }, async (c) => {
    base = await criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 10,
      vagasMoto: 1,
      vigenteDesde: new Date(Date.now() - 86_400_000),
    });
  });
});
afterAll(async () => {
  rmSync(pastaBackups(), { recursive: true, force: true });
  await fecharPool();
});

describe.skipIf(!temMysqldump)('backup do banco', () => {
  let id: string;
  let arquivo: string;

  it('faz o backup sem parar a operação: entradas durante o backup funcionam normalmente', async () => {
    const backup = admin.post('/api/v1/backups').send({});
    const entradas = Promise.all(
      ['BKP1A11', 'BKP1A22', 'BKP1A33'].map((placa) =>
        admin.post('/api/v1/sessoes/entrada').send({ placa, categoriaId: base.categorias.carro }),
      ),
    );
    const [b, es] = await Promise.all([backup, entradas]);
    expect(es.map((e) => e.status)).toEqual([201, 201, 201]);
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ status: 'SUCESSO', verificacao: 'OK', tipo: 'MANUAL' });
    id = b.body.id;
    arquivo = join(pastaBackups(), b.body.arquivo);
  });

  it('arquivo criptografado (nada legível), com manifesto e hash', () => {
    const bytes = readFileSync(arquivo);
    expect(bytes.subarray(0, 8).toString()).toBe('ESTBKP1\n');
    expect(bytes.toString('latin1')).not.toMatch(/CREATE TABLE|INSERT INTO|BKP1A11/);
    const m = JSON.parse(readFileSync(`${arquivo}.json`, 'utf8'));
    expect(m).toMatchObject({
      formato: 1,
      id,
      banco: env.DB_NAME,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(m.tabelas).toBeGreaterThan(20);
    expect(m.gatilhos).toBeGreaterThan(20);
    expect(m.migracoes).toContain('014_backups.sql');
  });

  it('teste de restauração: banco temporário com as mesmas tabelas, gatilhos e migrações (o banco em uso não é tocado)', async () => {
    const [[antes]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM sessoes_estacionamento');
    const r = await backupService.testarRestauracao(id);
    expect(r.ok).toBe(true);
    const [[depois]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM sessoes_estacionamento');
    expect(depois?.n).toEqual(antes?.n);
    const [bancos] = await pool.query<RowDataPacket[]>("SHOW DATABASES LIKE '%teste_restauracao'");
    expect(bancos).toHaveLength(0); // o temporário foi apagado
  });

  it('verificação de integridade: arquivo alterado ou sumido é apontado', async () => {
    const original = readFileSync(arquivo);
    const alterado = Buffer.from(original);
    const meio = Math.floor(alterado.length / 2);
    alterado[meio] = alterado[meio]! ^ 0xff;
    writeFileSync(arquivo, alterado);
    expect((await backupService.verificar(id)).verificacao).toBe('CORROMPIDO');
    rmSync(arquivo);
    expect((await backupService.verificar(id)).verificacao).toBe('AUSENTE');
    writeFileSync(arquivo, original);
    expect((await backupService.verificar(id)).verificacao).toBe('OK');
  });

  it('falha registrada com o motivo (sem dados pessoais) e o painel mostra', async () => {
    const antes = env.MYSQL_BIN_DIR;
    (env as { MYSQL_BIN_DIR?: string }).MYSQL_BIN_DIR = '/pasta/que/nao/existe';
    const r = await backupService.criar('AUTOMATICO');
    (env as { MYSQL_BIN_DIR?: string }).MYSQL_BIN_DIR = antes;
    expect(r).toMatchObject({ status: 'FALHA', erro: expect.stringMatching(/MYSQL_BIN_DIR/) });
    const s = (await admin.get('/api/v1/backups').expect(200)).body;
    expect(s.situacao.ultimaFalha.id).toBe(r.id);
    expect(s.situacao.ultimoSucesso.id).toBe(id);
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM historico_atividades WHERE acao = 'backup.falhou'",
    );
    expect(Number(h?.n)).toBe(1);
  });

  it('retenção: mantém diários, semanais e mensais; apaga o resto (arquivo e manifesto)', async () => {
    // 40 backups "antigos", um por dia
    const dia = 86_400_000;
    for (let i = 1; i <= 40; i++) {
      const nome = `backup-antigo-${i}.sql.gz.enc`;
      writeFileSync(join(pastaBackups(), nome), 'x');
      writeFileSync(join(pastaBackups(), `${nome}.json`), '{}');
      await pool.query(
        "INSERT INTO backups (id, tipo, status, iniciado_em, arquivo) VALUES (?, 'AUTOMATICO', 'SUCESSO', ?, ?)",
        [`01JANTIGO${String(i).padStart(17, '0')}`, new Date(Date.now() - i * dia), nome],
      );
    }
    const removidos = await backupService.aplicarRetencao();
    const [vivos] = await pool.query<RowDataPacket[]>(
      "SELECT arquivo FROM backups WHERE status = 'SUCESSO' AND removido_em IS NULL",
    );
    // 7 diários + até 4 semanais + mensais (sem repetir) e o mais recente
    expect(vivos.length).toBeGreaterThanOrEqual(7);
    expect(vivos.length).toBeLessThanOrEqual(7 + 4 + 2);
    expect(removidos).toBe(41 - vivos.length);
    expect(existsSync(arquivo)).toBe(true); // o mais recente fica
    expect(existsSync(join(pastaBackups(), 'backup-antigo-40.sql.gz.enc'))).toBe(false);
  });

  it('só quem tem backup.gerenciar', async () => {
    await criarUsuario({ login: 'caixa-bkp', senha: 'Senha12345', permissoes: ['sessao.entrada'] });
    const caixa = await entrar(app, 'caixa-bkp', 'Senha12345');
    await caixa.get('/api/v1/backups').expect(403);
    await caixa.post('/api/v1/backups').send({}).expect(403);
  });
});
