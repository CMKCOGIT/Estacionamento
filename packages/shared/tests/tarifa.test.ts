import { describe, expect, it } from 'vitest';
import {
  calcularTarifa,
  descreverCondicao,
  detalharTarifa,
  especialSeAplica,
  minutosDePermanencia,
  problemasDaRegra,
  type RegraTarifa,
} from '../src/index.js';

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

describe('regras de arredondamento (carência por período)', () => {
  const comCarencia: RegraTarifa = { ...carro, carenciaMin: 5 };
  it.each([
    [65, 1000, '1h05: dentro da carência, sem fração'],
    [66, 1200, '1h06: passou da carência, 1 fração'],
    [80, 1200, '1h20: ainda 1 fração (15 + 5 de carência)'],
    [81, 1400, '1h21: 2 frações'],
    [123, 1600, '2h03: horas cheias, sobra dentro da carência'],
  ])('%i min → %i centavos (%s)', (minutos, esperado) => {
    expect(calcularTarifa(comCarencia, minutos)).toBe(esperado);
  });
  it('sem fração, a carência vale para cada hora adicional', () => {
    const r: RegraTarifa = { ...semFracaoSemTeto, carenciaMin: 10 };
    expect(calcularTarifa(r, 70)).toBe(1000);
    expect(calcularTarifa(r, 71)).toBe(1600);
    expect(calcularTarifa(r, 130)).toBe(1600);
  });
  it('carência 0 é o mesmo que antes (arredonda para cima)', () => {
    for (const m of [0, 11, 61, 76, 140, 170, 600, 1500, 3000])
      expect(calcularTarifa({ ...carro, carenciaMin: 0 }, m)).toBe(calcularTarifa(carro, m));
  });
});

describe('tarifa especial de preço fixo', () => {
  const evento: RegraTarifa = { ...carro, valorFixoCentavos: 2500, toleranciaMin: 5 };
  it('cobra o valor fixo por período de 24h iniciado, depois da tolerância', () => {
    expect(calcularTarifa(evento, 5)).toBe(0);
    expect(calcularTarifa(evento, 6)).toBe(2500);
    expect(calcularTarifa(evento, 600)).toBe(2500);
    expect(calcularTarifa(evento, 1441)).toBe(5000);
  });
});

describe('detalharTarifa', () => {
  it('os itens somam exatamente o valor cobrado', () => {
    for (const regra of [carro, semFracaoSemTeto, { ...carro, carenciaMin: 5 }])
      for (let m = 0; m <= 3000; m += 7) {
        const d = detalharTarifa(regra, m);
        expect(d.totalCentavos).toBe(d.itens.reduce((t, i) => t + i.totalCentavos, 0));
        expect(d.totalCentavos).toBe(calcularTarifa(regra, m));
      }
  });
  it('explica o exemplo da documentação (2h20 = R$ 20,00)', () => {
    expect(detalharTarifa(carro, 140).itens).toEqual([
      { descricao: '1ª hora', quantidade: 1, unitarioCentavos: 1000, totalCentavos: 1000 },
      { descricao: 'Hora adicional', quantidade: 1, unitarioCentavos: 600, totalCentavos: 600 },
      { descricao: 'Fração de 15 min', quantidade: 2, unitarioCentavos: 200, totalCentavos: 400 },
    ]);
  });
  it('mostra o teto e a fração limitada', () => {
    expect(detalharTarifa(carro, 600).itens.map((i) => i.descricao)).toEqual([
      'Diária máxima (limite do período)',
    ]);
    expect(detalharTarifa(carro, 170).itens.at(-1)?.descricao).toMatch(/limitada/);
  });
});

describe('problemasDaRegra', () => {
  it('aponta carência maior que o período e fração incompleta', () => {
    expect(problemasDaRegra(carro)).toEqual([]);
    expect(problemasDaRegra({ ...carro, carenciaMin: 15 })[0]).toMatch(/carência/);
    expect(problemasDaRegra({ ...carro, fracaoCentavos: null })[0]).toMatch(/fração/);
    expect(problemasDaRegra({ ...carro, diariaMaximaCentavos: 500 })[0]).toMatch(/diária máxima/);
  });
});

describe('especialSeAplica', () => {
  const noite = { diasSemana: 62, horaInicio: '18:00', horaFim: '06:00' }; // seg-sex, atravessa a meia-noite
  it.each([
    [1, 18 * 60, true, 'segunda 18:00'],
    [1, 17 * 60 + 59, false, 'segunda 17:59'],
    [2, 3 * 60, true, 'terça 03:00 (janela de segunda)'],
    [6, 2 * 60, true, 'sábado 02:00 (janela de sexta)'],
    [6, 20 * 60, false, 'sábado 20:00'],
    [1, 2 * 60, false, 'segunda 02:00 (janela de domingo)'],
  ])('dia %i, minuto %i → %s (%s)', (dia, minuto, esperado) => {
    expect(especialSeAplica(noite, dia, minuto)).toBe(esperado);
  });
  it('sem janela vale o dia todo; sem dias vale todos', () => {
    expect(especialSeAplica({ diasSemana: 65, horaInicio: null, horaFim: null }, 0, 600)).toBe(true);
    expect(especialSeAplica({ diasSemana: 65, horaInicio: null, horaFim: null }, 3, 600)).toBe(false);
    expect(especialSeAplica({ diasSemana: null, horaInicio: '08:00', horaFim: '12:00' }, 3, 600)).toBe(true);
    expect(descreverCondicao(noite)).toBe('Seg a Sex, entrada das 18:00 às 06:00');
  });
});
