import { criarBancoLocal } from '../../src/db/scripts-sql.js';

/**
 * Antes dos testes de integração: recria um banco ISOLADO (estacionamento_teste
 * por padrão) a partir dos scripts. O banco real nunca é tocado.
 */
export default async function setup(): Promise<void> {
  const banco = process.env.DB_NAME_TESTE ?? 'estacionamento_teste';
  if (!banco.includes('teste')) {
    throw new Error(
      `Por segurança, os testes de integração só rodam em banco com "teste" no nome (recebido: ${banco})`,
    );
  }
  await criarBancoLocal({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    banco,
    recriar: true,
  });
}
