import { describe, expect, it } from 'vitest';
import {
  cpfValido,
  centavosParaCampo,
  formatarCentavos,
  lerCentavos,
  formatarCpf,
  formatarPlaca,
  normalizarPlaca,
  placaValida,
} from '../src/index.js';

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

describe('cpf', () => {
  it('valida pelos dígitos verificadores', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('123')).toBe(false);
  });
  it('formata', () => {
    expect(formatarCpf('52998224725')).toBe('529.982.247-25');
  });
});

describe('códigos de vaga', () => {
  it('gera lote com zeros à esquerda e ordena naturalmente', async () => {
    const { gerarCodigosVaga, compararCodigos } = await import('../src/index.js');
    expect(gerarCodigosVaga('a-', 9, 3, 2)).toEqual(['A-09', 'A-10', 'A-11']);
    expect(['A-10', 'A-2', 'A-1'].sort(compararCodigos)).toEqual(['A-1', 'A-2', 'A-10']);
  });
});

describe('lerCentavos', () => {
  it('lê os formatos que o operador digita', () => {
    expect(lerCentavos('18')).toBe(1800);
    expect(lerCentavos('18,5')).toBe(1850);
    expect(lerCentavos('R$ 1.234,56')).toBe(123456);
    expect(lerCentavos('18.50')).toBe(1850);
    expect(lerCentavos('1.000')).toBe(100000);
    expect(lerCentavos('0,07')).toBe(7);
    expect(lerCentavos('')).toBeNull();
    expect(lerCentavos('abc')).toBeNull();
    expect(lerCentavos('1,234')).toBeNull();
    expect(centavosParaCampo(2050)).toBe('20,50');
  });
});
