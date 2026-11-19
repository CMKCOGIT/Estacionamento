import { describe, expect, it } from 'vitest';
import { formatarCentavos, formatarPlaca, normalizarPlaca, placaValida } from '../src/index.js';

describe('placa', () => {
  it('normaliza', () => {
    expect(normalizarPlaca(' abc-1d23 ')).toBe('ABC1D23');
  });
  it('valida padrão antigo e Mercosul', () => {
    expect(placaValida('ABC-1234')).toBe(true);
    expect(placaValida('abc1d23')).toBe(true);
    expect(placaValida('AB12345')).toBe(false);
    expect(placaValida('AB123CD', true)).toBe(true);
  });
  it('formata para exibição', () => {
    expect(formatarPlaca('abc1234')).toBe('ABC-1234');
    expect(formatarPlaca('abc1d23')).toBe('ABC1D23');
  });
});

describe('dinheiro', () => {
  it('formata centavos em reais', () => {
    expect(formatarCentavos(1850).replace(/\s/g, ' ')).toBe('R$ 18,50');
  });
  it('rejeita valor não inteiro', () => {
    expect(() => formatarCentavos(10.5)).toThrow();
  });
});
