/**
 * Cria o banco local e aplica os scripts de database/local.
 *
 *   npm run db:criar                      # usa DB_NAME do .env
 *   npm run db:criar -- --banco=outro     # outro nome
 *   npm run db:criar -- --recriar         # APAGA e recria (só fora de produção)
 */
import { env } from '../src/config/env.js';
import { criarBancoLocal } from '../src/db/scripts-sql.js';

const args = process.argv.slice(2);
const recriar = args.includes('--recriar');
const banco = args.find((a) => a.startsWith('--banco='))?.split('=')[1] ?? env.DB_NAME;

if (recriar && env.NODE_ENV === 'production') {
  console.error('--recriar não é permitido com NODE_ENV=production.');
  process.exit(1);
}

try {
  console.log(
    `Criando banco "${banco}" em ${env.DB_HOST}:${env.DB_PORT}${recriar ? ' (recriando do zero)' : ''}...`,
  );
  const aplicados = await criarBancoLocal({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    banco,
    recriar,
    aoAplicar: (arquivo) => console.log(`  ✔ ${arquivo}`),
  });
  console.log(`Pronto: ${aplicados.length} scripts aplicados.`);
} catch (erro) {
  console.error(`\nFalha: ${(erro as Error).message}`);
  process.exit(1);
}
