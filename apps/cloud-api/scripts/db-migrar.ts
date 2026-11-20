import { env } from '../src/config/env.js';
import { migrarBancoNuvem } from '../src/db/migrar.js';

const aplicados = await migrarBancoNuvem({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  banco: env.DB_NAME,
});
console.log(
  aplicados.length
    ? `Banco da nuvem atualizado: ${aplicados.join(', ')}`
    : 'Banco da nuvem já estava atualizado.',
);
