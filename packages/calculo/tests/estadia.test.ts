import { describe, expect, it } from 'vitest';
import type { Modalidade, RegraTarifa } from '@estacionamento/shared';
import { calcularEstadia, calcularTarifa, ErroCalculo, proximoMinutoDeCobranca } from '../src/index.js';

/** Tabela de exemplo (carro): 1ª hora 10,00 · hora adicional 6,00 · fração 15 min 2,00 · teto 40,00 · diária 35,00 · tolerância 10 min. */
const CARRO: RegraTarifa = {
  toleranciaMin: 10,
  primeiraHoraCentavos: 1000,
  horaAdicionalCentavos: 600,
  fracaoMin: 15,
  fracaoCentavos: 200,
  diariaMaximaCentavos: 4000,
  diariaCentavos: 3500,
  carenciaMin: 0,
  valorFixoCentavos: null,
};

const ENTRADA = new Date('2026-11-19T22:30:00.000Z');
const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;
const D = 24 * H;
const depois = (ms: number) => new Date(ENTRADA.getTime() + ms);

/** Saída `ms` depois da entrada. */
function valor(ms: number, regra: RegraTarifa = CARRO, modalidade: Modalidade = 'AVULSO') {
  return calcularEstadia({ entradaEm: ENTRADA, fim: depois(ms), regra, modalidade }).valorFinalCentavos;
}

describe('permanência medida pelo horário de entrada e de saída', () => {
  it.each([
    ['saiu no mesmo instante', 0, 0],
    ['30 segundos (conta 1 minuto, dentro da tolerância)', 30 * S, 0],
    ['exatamente 10 min (limite da tolerância)', 10 * MIN, 0],
    ['10 min e 1 s (passou da tolerância: 1ª hora)', 10 * MIN + S, 1000],
    ['59 min', 59 * MIN, 1000],
    ['1 hora exata', H, 1000],
    ['1 hora e 1 segundo (o minuto iniciado conta: 1 fração)', H + S, 1200],
    ['1h15 (1 fração)', H + 15 * MIN, 1200],
    ['1h16 (2 frações)', H + 16 * MIN, 1400],
    ['1h45 (3 frações = valor da hora adicional)', H + 45 * MIN, 1600],
    ['1h46 (4 frações, limitadas à hora adicional)', H + 46 * MIN, 1600],
    ['2 horas exatas', 2 * H, 1600],
    ['2h20 (exemplo da documentação)', 2 * H + 20 * MIN, 2000],
    ['6 horas (encosta no teto de 40,00)', 6 * H, 4000],
    ['7 horas (teto da diária máxima)', 7 * H, 4000],
    ['23h59', D - MIN, 4000],
    ['24 horas exatas = 1 diária máxima', D, 4000],
    ['24h01 = 1 diária + 1ª hora do dia seguinte', D + MIN, 5000],
    ['25h20 = 1 diária + 1h20 (14,00)', D + H + 20 * MIN, 5400],
    ['3 dias exatos', 3 * D, 12000],
    ['3 dias e 5 min (dentro de 10 min, mas a tolerância só vale no início)', 3 * D + 5 * MIN, 13000],
  ])('%s', (_nome, ms, esperado) => {
    expect(valor(ms)).toBe(esperado);
  });

  it('atravessar a meia-noite não muda nada no modo por tempo (22:30 → 01:10)', () => {
    const r = calcularEstadia({
      entradaEm: ENTRADA,
      fim: new Date('2026-11-20T01:10:00.000Z'),
      regra: CARRO,
      modalidade: 'AVULSO',
    });
    expect(r.permanenciaMin).toBe(160);
    expect(r.valorFinalCentavos).toBe(2200);
  });

  it('relógio fora de ordem (saída antes da entrada) não gera cobrança negativa', () => {
    expect(valor(-5 * MIN)).toBe(0);
  });
});

describe('diárias', () => {
  it.each([
    ['dentro da tolerância', 5 * MIN, 0],
    ['5 horas', 5 * H, 3500],
    ['24 horas exatas', D, 3500],
    ['24h e 1 s (segunda diária)', D + S, 7000],
    ['2 dias e meio', 2.5 * D, 10500],
  ])('modo diária: %s', (_n, ms, esperado) => {
    expect(valor(ms, CARRO, 'DIARIA')).toBe(esperado);
  });

  it('sem diária máxima, cada 24h completas custam as horas do dia', () => {
    const semTeto = { ...CARRO, diariaMaximaCentavos: null, fracaoMin: null, fracaoCentavos: null };
    // 24h = 1000 + 23 × 600
    expect(valor(D, semTeto)).toBe(14_800);
    expect(valor(D + 30 * MIN, semTeto)).toBe(14_800 + 1000);
  });

  it('tarifa sem diária recusa o modo diária', () => {
    expect(() =>
      calcularEstadia({
        entradaEm: ENTRADA,
        fim: depois(H),
        regra: { ...CARRO, diariaCentavos: null },
        modalidade: 'DIARIA',
      }),
    ).toThrow(ErroCalculo);
  });
});

describe('frações, tolerância e arredondamento configuráveis', () => {
  it('sem fração: cobra por hora cheia', () => {
    const horaCheia = { ...CARRO, fracaoMin: null, fracaoCentavos: null };
    expect(valor(H + MIN, horaCheia)).toBe(1600);
    expect(valor(2 * H, horaCheia)).toBe(1600);
    expect(valor(2 * H + MIN, horaCheia)).toBe(2200);
  });

  it('fração de 30 min', () => {
    const meiaHora = { ...CARRO, fracaoMin: 30, fracaoCentavos: 350 };
    expect(valor(H + 30 * MIN, meiaHora)).toBe(1350);
    expect(valor(H + 31 * MIN, meiaHora)).toBe(1600); // 2 × 3,50 = 7,00 → limitado a 6,00
  });

  it('sem tolerância: qualquer minuto cobra a 1ª hora', () => {
    expect(valor(S, { ...CARRO, toleranciaMin: 0 })).toBe(1000);
  });

  it('carência de 5 min por período', () => {
    const c5 = { ...CARRO, carenciaMin: 5 };
    expect(valor(H + 5 * MIN, c5)).toBe(1000);
    expect(valor(H + 5 * MIN + S, c5)).toBe(1200);
    expect(valor(H + 20 * MIN, c5)).toBe(1200);
    expect(valor(H + 21 * MIN, c5)).toBe(1400);
  });

  it('preço fixo (tarifa especial) por 24h iniciadas', () => {
    const evento = { ...CARRO, valorFixoCentavos: 2500 };
    expect(valor(5 * MIN, evento)).toBe(0);
    expect(valor(11 * MIN, evento)).toBe(2500);
    expect(valor(D, evento)).toBe(2500);
    expect(valor(D + MIN, evento)).toBe(5000);
  });
});

describe('valor acumulado, ajustes e saldo', () => {
  it('desconto, acréscimo e o que já foi pago', () => {
    const r = calcularEstadia({
      entradaEm: ENTRADA,
      fim: depois(2 * H + 20 * MIN),
      regra: CARRO,
      modalidade: 'AVULSO',
      descontoCentavos: 500,
      acrescimoCentavos: 100,
      pagoCentavos: 1000,
    });
    expect(r).toMatchObject({
      valorCalculadoCentavos: 2000,
      valorFinalCentavos: 1600,
      pagoCentavos: 1000,
      aPagarCentavos: 600,
      excedentePagoCentavos: 0,
    });
  });

  it('pago a mais aparece como excedente (não como saldo negativo)', () => {
    const r = calcularEstadia({
      entradaEm: ENTRADA,
      fim: depois(H),
      regra: CARRO,
      modalidade: 'AVULSO',
      pagoCentavos: 1500,
    });
    expect(r.aPagarCentavos).toBe(0);
    expect(r.excedentePagoCentavos).toBe(500);
  });

  it('desconto maior que a estadia é recusado; valores devem ser inteiros', () => {
    const base = { entradaEm: ENTRADA, fim: depois(H), regra: CARRO, modalidade: 'AVULSO' as const };
    expect(() => calcularEstadia({ ...base, descontoCentavos: 1001 })).toThrow(/desconto não pode ser maior/);
    expect(() => calcularEstadia({ ...base, pagoCentavos: 1.5 })).toThrow(ErroCalculo);
  });

  it('próxima cobrança: quando o valor sobe e para quanto', () => {
    const agora = depois(H + 20 * MIN); // 1h20 → 14,00
    const r = calcularEstadia({
      entradaEm: ENTRADA,
      fim: agora,
      regra: CARRO,
      modalidade: 'AVULSO',
      emAndamento: true,
    });
    expect(r.valorFinalCentavos).toBe(1400);
    // Sobe para 16,00 quando passar de 1h30 (1h30 + 1 ms)
    expect(r.proximaCobranca).toEqual({
      em: depois(H + 30 * MIN + 1),
      permanenciaMin: 91,
      valorCentavos: 1600,
    });
    expect(valor(H + 30 * MIN)).toBe(1400);
    expect(valor(H + 30 * MIN + 1)).toBe(1600);
  });

  it('próxima cobrança dentro da tolerância, no teto e na diária', () => {
    const prox = (ms: number, modalidade: Modalidade = 'AVULSO') =>
      calcularEstadia({ entradaEm: ENTRADA, fim: depois(ms), regra: CARRO, modalidade, emAndamento: true })
        .proximaCobranca;
    expect(prox(3 * MIN)).toMatchObject({ permanenciaMin: 11, valorCentavos: 1000 });
    expect(prox(8 * H)).toMatchObject({ em: depois(D + 1), valorCentavos: 5000 }); // no teto: só sobe no dia seguinte
    expect(prox(2 * H, 'DIARIA')).toMatchObject({ em: depois(D + 1), valorCentavos: 7000 });
  });

  it('sem "em andamento" não calcula a próxima cobrança (estadia encerrada)', () => {
    expect(
      calcularEstadia({ entradaEm: ENTRADA, fim: depois(H), regra: CARRO, modalidade: 'AVULSO' })
        .proximaCobranca,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Consistência: propriedades que valem para QUALQUER regra
// ---------------------------------------------------------------------------

/** Gerador determinístico (os testes dão sempre o mesmo resultado). */
function* regrasAleatorias(qtd: number): Generator<RegraTarifa> {
  let x = 20261119;
  const prox = (max: number) => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x % max;
  };
  for (let i = 0; i < qtd; i++) {
    const primeira = 100 + prox(3000);
    const fracaoMin = prox(3) === 0 ? null : [5, 10, 15, 20, 30][prox(5)]!;
    yield {
      toleranciaMin: prox(31),
      primeiraHoraCentavos: primeira,
      horaAdicionalCentavos: 50 + prox(2000),
      fracaoMin,
      fracaoCentavos: fracaoMin === null ? null : 10 + prox(800),
      carenciaMin: prox(Math.min(fracaoMin ?? 60, 10)),
      diariaMaximaCentavos: prox(2) ? primeira + prox(8000) : null,
      diariaCentavos: prox(2) ? 500 + prox(6000) : null,
      valorFixoCentavos: prox(6) === 0 ? 100 + prox(5000) : null,
    };
  }
}
const REGRAS = [CARRO, ...regrasAleatorias(60)];

describe('consistência do cálculo (60 regras aleatórias + a tabela de exemplo)', () => {
  it('o valor nunca diminui com o tempo e nunca é negativo (até 4 dias, minuto a minuto)', () => {
    for (const regra of REGRAS)
      for (const modalidade of ['AVULSO', 'DIARIA'] as const) {
        if (modalidade === 'DIARIA' && regra.diariaCentavos === null) continue;
        let anterior = 0;
        for (let m = 0; m <= 4 * 1440; m++) {
          const v = calcularTarifa(regra, m, modalidade);
          expect(v).toBeGreaterThanOrEqual(anterior);
          anterior = v;
        }
      }
  });

  it('nenhum período de 24h custa mais que a diária máxima', () => {
    for (const regra of REGRAS.filter((r) => r.diariaMaximaCentavos !== null && !r.valorFixoCentavos))
      for (let m = 0; m <= 1440; m += 7)
        expect(calcularTarifa(regra, m)).toBeLessThanOrEqual(regra.diariaMaximaCentavos!);
  });

  it('os itens sempre somam o valor cobrado', () => {
    for (const regra of REGRAS)
      for (let ms = 0; ms <= 3 * D; ms += 17 * MIN + 13 * S) {
        const r = calcularEstadia({ entradaEm: ENTRADA, fim: depois(ms), regra, modalidade: 'AVULSO' });
        expect(r.itens.reduce((t, i) => t + i.totalCentavos, 0)).toBe(r.valorCalculadoCentavos);
      }
  });

  it('o valor acumulado no instante da saída é exatamente o valor final cobrado', () => {
    for (const regra of REGRAS)
      for (let ms = 0; ms <= 2 * D; ms += 23 * MIN + 7 * S) {
        const dados = { entradaEm: ENTRADA, fim: depois(ms), regra, modalidade: 'AVULSO' as const };
        const durante = calcularEstadia({ ...dados, emAndamento: true });
        const saida = calcularEstadia(dados);
        expect(durante.valorFinalCentavos).toBe(saida.valorFinalCentavos);
        expect(durante.itens).toEqual(saida.itens);
      }
  });

  it('só a duração importa: o mesmo tempo em outro dia/horário custa o mesmo', () => {
    for (const regra of REGRAS.slice(0, 15))
      for (const ms of [7 * MIN, 61 * MIN, 5 * H + 3 * S, 30 * H]) {
        const outro = new Date('2027-02-28T03:17:41.123Z');
        const a = calcularEstadia({ entradaEm: ENTRADA, fim: depois(ms), regra, modalidade: 'AVULSO' });
        const b = calcularEstadia({
          entradaEm: outro,
          fim: new Date(outro.getTime() + ms),
          regra,
          modalidade: 'AVULSO',
        });
        expect(b.valorFinalCentavos).toBe(a.valorFinalCentavos);
      }
  });

  it('a próxima cobrança é o primeiro minuto em que o valor sobe (confere com busca minuto a minuto)', () => {
    for (const regra of REGRAS)
      for (const modalidade of ['AVULSO', 'DIARIA'] as const) {
        if (modalidade === 'DIARIA' && regra.diariaCentavos === null) continue;
        for (let m = 0; m <= 2 * 1440; m += 37) {
          const atual = calcularTarifa(regra, m, modalidade);
          let esperado: number | null = null;
          for (let k = m + 1; k <= m + 1441; k++)
            if (calcularTarifa(regra, k, modalidade) > atual) {
              esperado = k;
              break;
            }
          expect(proximoMinutoDeCobranca(regra, m, modalidade)).toBe(esperado);
        }
      }
  });
});
