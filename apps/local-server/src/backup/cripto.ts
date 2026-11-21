import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Transform, type Readable } from 'node:stream';

/**
 * Criptografia dos backups: AES-256-GCM (confidencialidade + integridade).
 * Formato do arquivo: "ESTBKP1\n" (8 bytes) | IV (12) | dados cifrados | tag (16).
 * Um único bit alterado no arquivo faz a decifragem falhar (tag inválida).
 */
export const MAGICO = Buffer.from('ESTBKP1\n', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Impressão curta da chave: diz QUAL chave abre o arquivo, sem revelar a chave. */
export const idDaChave = (chave: Buffer) => createHash('sha256').update(chave).digest('hex').slice(0, 16);

/**
 * Chave: BACKUP_CHAVE (base64, 32 bytes) ou um arquivo gerado na primeira vez.
 * Sem a chave, nenhum backup pode ser restaurado: guarde uma cópia fora deste
 * computador (docs/BACKUP.md).
 */
export function carregarChave(
  valorEnv: string | undefined,
  arquivo: string,
): { chave: Buffer; gerada: boolean } {
  if (valorEnv) {
    const chave = Buffer.from(valorEnv, 'base64');
    if (chave.length !== 32) throw new Error('BACKUP_CHAVE precisa ter 32 bytes em base64 (44 caracteres).');
    return { chave, gerada: false };
  }
  if (existsSync(arquivo)) {
    const chave = Buffer.from(readFileSync(arquivo, 'utf8').trim(), 'base64');
    if (chave.length !== 32) throw new Error(`Arquivo de chave inválido: ${arquivo}`);
    return { chave, gerada: false };
  }
  const chave = randomBytes(32);
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, `${chave.toString('base64')}\n`, { mode: 0o600 });
  try {
    chmodSync(arquivo, 0o600);
  } catch {
    // Windows: permissões pelo NTFS (pasta do servidor)
  }
  return { chave, gerada: true };
}

/** Transform que cifra o fluxo e escreve cabeçalho + IV no início e a tag no fim. */
export function cifrador(chave: Buffer): Transform {
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv('aes-256-gcm', chave, iv);
  let inicio = true;
  return new Transform({
    transform(pedaco: Buffer, _e, feito) {
      if (inicio) {
        this.push(MAGICO);
        this.push(iv);
        inicio = false;
      }
      feito(null, c.update(pedaco));
    },
    flush(feito) {
      if (inicio) {
        this.push(MAGICO);
        this.push(iv);
      }
      this.push(c.final());
      this.push(c.getAuthTag());
      feito();
    },
  });
}

/** Lê um arquivo cifrado e devolve o fluxo decifrado (a tag é conferida no fim). */
export async function decifrarArquivo(caminho: string, chave: Buffer): Promise<Readable> {
  const f = await open(caminho, 'r');
  const { size } = await f.stat();
  if (size < MAGICO.length + IV_BYTES + TAG_BYTES) {
    await f.close();
    throw new Error('Arquivo de backup incompleto.');
  }
  const cab = Buffer.alloc(MAGICO.length + IV_BYTES);
  await f.read(cab, 0, cab.length, 0);
  const tag = Buffer.alloc(TAG_BYTES);
  await f.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  await f.close();
  if (!cab.subarray(0, MAGICO.length).equals(MAGICO))
    throw new Error('Não é um arquivo de backup deste sistema.');
  const d = createDecipheriv('aes-256-gcm', chave, cab.subarray(MAGICO.length));
  d.setAuthTag(tag);
  const { createReadStream } = await import('node:fs');
  return createReadStream(caminho, { start: cab.length, end: size - TAG_BYTES - 1 }).pipe(d);
}
