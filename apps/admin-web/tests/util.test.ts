import { describe, expect, it } from 'vitest';
import { ticksBonitos } from '../src/components/graficos/util';

describe('ticksBonitos', () => {
  it('veículos: só inteiros, mesmo sem dados', () => {
    expect(ticksBonitos(0, 4, 1)).toEqual([0, 1, 2, 3, 4]);
    expect(ticksBonitos(3, 4, 1)).toEqual([0, 1, 2, 3, 4]);
    expect(ticksBonitos(38, 4, 1)).toEqual([0, 10, 20, 30, 40]);
    expect(ticksBonitos(9, 4, 1).every(Number.isInteger)).toBe(true);
  });
  it('dinheiro em centavos: passos de reais inteiros', () => {
    expect(ticksBonitos(10_000, 4, 100)).toEqual([0, 2500, 5000, 7500, 10000]);
    expect(ticksBonitos(154_000, 4, 100)).toEqual([0, 50000, 100000, 150000, 200000]);
    expect(ticksBonitos(300, 4, 100)).toEqual([0, 100, 200, 300, 400]);
  });
});
