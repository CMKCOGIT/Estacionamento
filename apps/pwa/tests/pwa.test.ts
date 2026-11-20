import { beforeEach, describe, expect, it } from 'vitest';
import type { TicketPublico } from '@estacionamento/shared';
import { atualizarUltimo, esquecer, lerTickets, salvarToken } from '../src/armazenamento';
import { duracao, haQuanto } from '../src/formato';
import { estrategiaPara } from '../src/sw-regras';
import { tokenDoLink } from '../src/token';

const TOKEN = 'a'.repeat(22) + 'B_-' + '9'.repeat(18); // 43 caracteres base64url
const APP = 'https://app.exemplo.com.br';
const API = 'https://api.exemplo.com.br';

class Memoria implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear = () => this.m.clear();
  getItem = (k: string) => this.m.get(k) ?? null;
  key = (i: number) => [...this.m.keys()][i] ?? null;
  removeItem = (k: string) => void this.m.delete(k);
  setItem = (k: string, v: string) => void this.m.set(k, v);
}

describe('token do link', () => {
  it('lê o token depois do #, só no formato certo', () => {
    expect(tokenDoLink(`#${TOKEN}`)).toBe(TOKEN);
    expect(tokenDoLink(TOKEN)).toBe(TOKEN);
    expect(tokenDoLink('#curto')).toBeNull();
    expect(tokenDoLink(`#${TOKEN}x`)).toBeNull();
    expect(tokenDoLink('#<script>alert(1)</script>aaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeNull();
    expect(tokenDoLink('')).toBeNull();
  });
});

describe('tickets guardados no celular', () => {
  beforeEach(() => {
    globalThis.localStorage = new Memoria();
  });

  it('guarda, move para o topo, limita a 5 e esquece', () => {
    const tokens = Array.from({ length: 6 }, (_, i) => `${i}`.repeat(43));
    for (const t of tokens) salvarToken(t);
    expect(lerTickets().map((t) => t.token)).toEqual(tokens.slice(1).reverse());
    salvarToken(tokens[2]!);
    expect(lerTickets()[0]!.token).toBe(tokens[2]);
    expect(esquecer(tokens[2]!).some((t) => t.token === tokens[2])).toBe(false);
  });

  it('guarda a última resposta para mostrar sem internet', () => {
    salvarToken(TOKEN);
    atualizarUltimo(TOKEN, { numero: '7' } as TicketPublico, new Date('2026-11-20T10:00:00Z'));
    expect(lerTickets()[0]).toMatchObject({ ultimo: { numero: '7' }, ultimoEm: '2026-11-20T10:00:00.000Z' });
  });

  it('sem localStorage (modo privado/bloqueado) não quebra o app', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('bloqueado');
      },
    });
    expect(lerTickets()).toEqual([]);
    expect(() => salvarToken(TOKEN)).not.toThrow();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new Memoria(),
      writable: true,
    });
  });

  it('dados corrompidos são ignorados', () => {
    localStorage.setItem('meu-ticket:tickets', '{nao é json');
    expect(lerTickets()).toEqual([]);
  });
});

describe('cache do service worker', () => {
  const regra = (
    url: string,
    extra: Partial<{ method: string; mode: string; temAutorizacao: boolean }> = {},
  ) => estrategiaPara({ url, method: 'GET', ...extra }, APP, API);

  it('o ticket NUNCA vai para cache', () => {
    expect(regra(`${API}/v1/ticket`)).toBe('somente-rede');
    expect(regra(`${API}/v1/sites/centro/tarifas`, { temAutorizacao: true })).toBe('somente-rede');
  });
  it('vagas e tarifas: rede primeiro com cópia offline; app sempre disponível', () => {
    expect(regra(`${API}/v1/sites/centro/disponibilidade`)).toBe('dados-publicos');
    expect(regra(`${API}/v1/sites/centro/tarifas`)).toBe('dados-publicos');
    expect(regra(`${APP}/assets/app-123.js`)).toBe('app');
    expect(regra(`${APP}/ticket`, { mode: 'navigate' })).toBe('navegacao');
  });
  it('outros domínios, outros métodos e o próprio sw.js ficam de fora', () => {
    expect(regra('https://outro.com/x.js')).toBe('ignorar');
    expect(regra(`${API}/v1/ticket`, { method: 'POST' })).toBe('ignorar');
    expect(regra(`${APP}/sw.js`)).toBe('ignorar');
    expect(regra(`${API}/outra-coisa`)).toBe('ignorar');
  });
});

describe('formatos', () => {
  it('duração e "há quanto tempo"', () => {
    expect(duracao(65_000)).toBe('1min 05s');
    expect(duracao(2 * 3600_000 + 5 * 60_000 + 12_000)).toBe('2h 05min 12s');
    expect(duracao(26 * 3600_000, false)).toBe('1d 2h 00min');
    const agora = Date.parse('2026-11-20T12:00:00Z');
    expect(haQuanto('2026-11-20T11:59:30Z', agora)).toBe('agora');
    expect(haQuanto('2026-11-20T11:45:00Z', agora)).toBe('há 15 min');
  });
});
