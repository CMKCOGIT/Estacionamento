import { describe, expect, it } from 'vitest';
import { derivarSegredo } from '../src/integracoes/credenciais.js';
import {
  atualizarEnv,
  derivarSegredo as derivarNoLocal,
  ID_INTEGRACAO,
} from '../../local-server/scripts/conectar-nuvem.js';

/** O Conectar-Nuvem.cmd gera no estacionamento o MESMO segredo que a nuvem espera. */
describe('Conectar-Nuvem', () => {
  it('o segredo gerado no servidor local é o mesmo da nuvem', () => {
    const chave = 'k'.repeat(44);
    expect(derivarNoLocal(chave)).toBe(derivarSegredo(ID_INTEGRACAO, 1, chave));
    expect(ID_INTEGRACAO).toMatch(/^[0-9A-Z]{26}$/);
  });

  it('atualiza o .env sem perder o resto (troca, descomenta ou acrescenta)', () => {
    const antes = 'DB_PASSWORD=segredo\r\n# CLOUD_API_URL=http://antigo\r\nPORT=8080\r\n';
    const depois = atualizarEnv(antes, { CLOUD_API_URL: 'https://api', SYNC_SECRET: 'abc' });
    expect(depois).toContain('DB_PASSWORD=segredo\r\n');
    expect(depois).toContain('CLOUD_API_URL=https://api\r\n');
    expect(depois).not.toContain('http://antigo');
    expect(depois).toContain('SYNC_SECRET=abc');
    expect(depois.replace(/\r\n/g, '')).not.toContain('\n');
    // Rodar de novo não duplica
    expect(atualizarEnv(depois, { SYNC_SECRET: 'xyz' }).match(/SYNC_SECRET=/g)).toHaveLength(1);
  });
});
