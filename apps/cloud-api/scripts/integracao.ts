/**
 * Credenciais das integrações (quem pode enviar dados para a nuvem).
 * Rode no servidor da API externa, com SYNC_CHAVE_MESTRA configurada.
 *
 *   npm run integracao -w @estacionamento/cloud-api -- criar --nome "Estacionamento Centro" [--site <SITE_ID>]
 *   npm run integracao -w @estacionamento/cloud-api -- listar
 *   npm run integracao -w @estacionamento/cloud-api -- girar   --id <ID>     (troca o segredo; o antigo vale por 24h)
 *   npm run integracao -w @estacionamento/cloud-api -- revogar --id <ID>
 *
 * "criar" mostra o ID e o SEGREDO uma única vez: copie-os para o .env do
 * servidor local (SYNC_INTEGRACAO_ID e SYNC_SECRET). Sem --site, a credencial
 * fica presa ao estacionamento que a usar primeiro.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ulid } from '../src/integracoes/ulid.js';
import { env } from '../src/config/env.js';
import { fecharPool, pool } from '../src/db/pool.js';
import { derivarSegredo, ESCOPOS_SERVIDOR_LOCAL } from '../src/integracoes/credenciais.js';

const [acao, ...resto] = process.argv.slice(2);
const opcao = (nome: string) => {
  const i = resto.indexOf(`--${nome}`);
  return i >= 0 ? resto[i + 1] : undefined;
};
const ID = /^[0-9A-Z]{26}$/;

async function principal() {
  if (!env.SYNC_CHAVE_MESTRA) throw new Error('Configure SYNC_CHAVE_MESTRA no .env da API externa.');
  switch (acao) {
    case 'criar': {
      const id = opcao('id') ?? ulid();
      const site = opcao('site') ?? null;
      const nome = opcao('nome') ?? 'Servidor local';
      if (!ID.test(id) || (site && !ID.test(site)))
        throw new Error('--id e --site precisam ser identificadores (26 caracteres).');
      const [[existe]] = await pool.query<RowDataPacket[]>(
        'SELECT versao_chave FROM integracoes WHERE id = ?',
        [id],
      );
      if (existe && resto.includes('--se-nao-existir')) {
        console.log(`Integração ${id} já existe.`);
        return;
      }
      if (existe) throw new Error(`Já existe a integração ${id}.`);
      await pool.query(
        "INSERT INTO integracoes (id, site_id, tipo, nome, escopos) VALUES (?, ?, 'SERVIDOR_LOCAL', ?, ?)",
        [id, site, nome, JSON.stringify(ESCOPOS_SERVIDOR_LOCAL)],
      );
      console.log(`Integração criada: ${nome}\n`);
      console.log('Copie para o .env do servidor local do estacionamento:');
      console.log(`  SYNC_INTEGRACAO_ID=${id}`);
      console.log(`  SYNC_SECRET=${derivarSegredo(id, 1)}`);
      console.log('\nO segredo não fica guardado em lugar nenhum: se perder, use "girar".');
      return;
    }
    case 'listar': {
      const [l] = await pool.query<RowDataPacket[]>(
        'SELECT id, site_id, nome, tipo, versao_chave, ativo, ultimo_uso_em FROM integracoes ORDER BY criado_em',
      );
      console.table(l.map((x) => ({ ...x, ativo: Boolean(Number(x.ativo)) })));
      return;
    }
    case 'girar': {
      const id = opcao('id') ?? '';
      const [r] = await pool.query<ResultSetHeader>(
        'UPDATE integracoes SET versao_chave = versao_chave + 1, anterior_valida_ate = NOW(3) + INTERVAL 24 HOUR WHERE id = ? AND ativo',
        [id],
      );
      if (!r.affectedRows) throw new Error('Integração não encontrada ou revogada.');
      const [[x]] = await pool.query<RowDataPacket[]>('SELECT versao_chave FROM integracoes WHERE id = ?', [
        id,
      ]);
      console.log('Novo segredo (o anterior continua valendo por 24h):');
      console.log(`  SYNC_SECRET=${derivarSegredo(id, Number(x!.versao_chave))}`);
      return;
    }
    case 'revogar': {
      const [r] = await pool.query<ResultSetHeader>('UPDATE integracoes SET ativo = FALSE WHERE id = ?', [
        opcao('id') ?? '',
      ]);
      console.log(
        r.affectedRows ? 'Integração revogada: ela não consegue mais enviar dados.' : 'Não encontrada.',
      );
      return;
    }
    default:
      console.log('Uso: integracao criar | listar | girar --id <ID> | revogar --id <ID>');
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
