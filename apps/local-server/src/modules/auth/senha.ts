import { hash, verify } from '@node-rs/argon2';

/**
 * Hash de senha com argon2id (vencedor da Password Hashing Competition).
 * Parâmetros mínimos recomendados pela OWASP: 19 MiB de memória, 2 iterações,
 * 1 thread. O resultado já inclui salt e parâmetros (formato PHC):
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 */
const PARAMETROS = {
  algorithm: 2, // Algorithm.Argon2id (const enum, não importável com verbatimModuleSyntax)
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function gerarHashSenha(senha: string): Promise<string> {
  return hash(senha, PARAMETROS);
}

/** Nunca lança: hash corrompido ou formato desconhecido = senha inválida. */
export async function conferirSenha(hashArmazenado: string, senha: string): Promise<boolean> {
  try {
    return await verify(hashArmazenado, senha);
  } catch {
    return false;
  }
}

/**
 * Quando o login não existe, ainda assim verificamos uma senha contra um hash
 * fictício: o tempo de resposta fica igual ao de um login existente e não dá
 * para descobrir quais logins existem medindo a demora.
 */
let hashFicticio: Promise<string> | undefined;
export async function gastarTempoDeVerificacao(senha: string): Promise<void> {
  hashFicticio ??= gerarHashSenha('senha-ficticia-para-equalizar-tempo');
  await conferirSenha(await hashFicticio, senha);
}
