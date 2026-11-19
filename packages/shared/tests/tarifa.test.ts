import { describe, expect, it } from 'vitest';
import { calcularTarifa, minutosDePermanencia, type RegraTarifa } from '../src/index.js';

/** Tabela de exemplo de docs/ARQUITETURA.md §8.2 (carro). */
const carro: RegraTarifa = {
  toleranciaMin: 10,
  primeiraHoraCentavos: 1000,
  horaAdicionalCentavos: 600,
  fracaoMin: 15,
  fracaoCentavos: 200,
  diariaMaximaCentavos: 4000,
  diariaCentavos: 3500,
};
const semFracaoSemTeto: RegraTarifa = {
  ...carro,
  fracaoMin: null,
  fracaoCentavos: null,
  diariaMaximaCentavos: null,
};

describe('calcularTarifa (modo avulso)', () => {
  it.each([
    [0, 0, 'sem permanência'],
    [10, 0, 'no limite da tolerância'],
    [11, 1000, 'passou da tolerância: 1ª hora'],
    [60, 1000, '1ª hora exata'],
    [61, 1200, '1ª hora + 1 fração'],
    [75, 1200, '1ª hora + 15 min = 1 fração'],
    [76, 1400, '1ª hora + 16 min = 2 frações'],
    [120, 1600, '2 horas cheias'],
    [140, 2000, 'exemplo da documentação: 2h20 = R$ 20,00'],
    [170, 2200, 'frações (3×2,00) limitadas à hora adicional (6,00)'],
    [600, 4000, 'teto da diária máxima'],
    [1440, 4000, '24h = 1 diária máxima'],
    [1500, 5000, '1 dia + 1h = 40,00 + 10,00'],
  ])('%i min → %i centavos (%s)', (minutos, esperado) => {
    expect(calcularTarifa(carro, minutos)).toBe(esperado);
  });

  it('sem fração: o que sobra conta como hora cheia', () => {
    expect(calcularTarifa(semFracaoSemTeto, 61)).toBe(1600);
  });

  it('sem teto: cada dia completo custa 24h de horas', () => {
    // 24h = 1000 + 23 × 600 = 14800
    expect(calcularTarifa(semFracaoSemTeto, 1440)).toBe(14_800);
  });

  it('rejeita minutos inválidos', () => {
    expect(() => calcularTarifa(carro, -1)).toThrow();
    expect(() => calcularTarifa(carro, 1.5)).toThrow();
  });
});

describe('calcularTarifa (modo diária)', () => {
  it('cobra por período de 24h iniciado', () => {
    expect(calcularTarifa(carro, 30, 'DIARIA')).toBe(3500);
    expect(calcularTarifa(carro, 1440, 'DIARIA')).toBe(3500);
    expect(calcularTarifa(carro, 1441, 'DIARIA')).toBe(7000);
  });
  it('respeita a tolerância', () => {
    expect(calcularTarifa(carro, 5, 'DIARIA')).toBe(0);
  });
});

describe('minutosDePermanencia', () => {
  it('arredonda para cima', () => {
    const entrada = new Date('2026-11-19T12:00:00Z');
    expect(minutosDePermanencia(entrada, new Date('2026-11-19T12:00:00Z'))).toBe(0);
    expect(minutosDePermanencia(entrada, new Date('2026-11-19T12:00:01Z'))).toBe(1);
    expect(minutosDePermanencia(entrada, new Date('2026-11-19T14:20:00Z'))).toBe(140);
  });
});
