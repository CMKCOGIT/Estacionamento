import { randomBytes } from 'node:crypto';

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID (26 caracteres, ordenável pelo tempo) sem dependência externa. */
export function ulid(agora = Date.now()): string {
  let tempo = '';
  for (let t = agora, i = 0; i < 10; i++, t = Math.floor(t / 32)) tempo = ALFABETO[t % 32] + tempo;
  const aleatorio = [...randomBytes(16)].map((b) => ALFABETO[b % 32]).join('');
  return tempo + aleatorio;
}
