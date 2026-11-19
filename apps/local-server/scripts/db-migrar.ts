/**
 * Cria o banco local (se não existir) e aplica as migrations pendentes de
 * database/local. Pode ser executado quantas vezes quiser: só aplica o que falta.
 *
 *   npm run db:migrar                      # usa DB_NAME do .env
 *   npm run db:migrar -- --banco=outro     # outro nome
 *   npm run db:migrar -- --recriar         # APAGA e recria (só fora de produção)
 */
import { env } from '../src/config/env.js';
import { migrarBancoLocal } from '../src/db/scripts-sql.js';

const args = process.argv.slice(2);
const recriar = args.includes('--recriar');
const banco = args.find((a) => a.startsWith('--banco='))?.split('=')[1] ?? env.DB_NAME;

if (recriar && env.NODE_ENV === 'production') {
  console.error('--recriar não é permitido com NODE_ENV=production.');
  process.exit(1);
}

try {
  console.log(`Banco "${banco}" em ${env.DB_HOST}:${env.DB_PORT}${recriar ? ' (recriando do zero)' : ''}`);
  const r = await migrarBancoLocal({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    banco,
    recriar,
    aoAplicar: (arquivo) => console.log(`  ✔ ${arquivo}`),
    aoAviso: (msg) => console.warn(`  ⚠ ${msg}`),
  });
  if (r.baseline) console.log('  (banco existente reconhecido: 001–004 registrados como já aplicados)');
  console.log(
    r.aplicadas.length
      ? `Pronto: ${r.aplicadas.length} migration(s) aplicada(s).`
      : 'Nada a fazer: o banco já está atualizado.',
  );
} catch (erro) {
  console.error(`\nFalha: ${(erro as Error).message}`);
  process.exit(1);
}
