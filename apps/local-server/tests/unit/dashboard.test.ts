import { describe, expect, it } from 'vitest';
import { calcularOcupacao24h, montarFaturamentoDias } from '../../src/modules/dashboard/dashboard.service.js';

describe('calcularOcupacao24h', () => {
  const agora = new Date('2026-11-19T15:40:00Z');
  const h = (iso: string) => new Date(iso);

  it('25 pontos: 24 horas cheias + agora', () => {
    const pontos = calcularOcupacao24h([], agora);
    expect(pontos).toHaveLength(25);
    expect(pontos[0]?.em).toBe('2026-11-18T16:00:00.000Z');
    expect(pontos[23]?.em).toBe('2026-11-19T15:00:00.000Z');
    expect(pontos[24]?.em).toBe(agora.toISOString());
  });

  it('conta quem estava dentro em cada instante', () => {
    const pontos = calcularOcupacao24h(
      [
        { entrada: h('2026-11-19T13:30:00Z'), saida: h('2026-11-19T15:10:00Z') }, // dentro às 14h e 15h
        { entrada: h('2026-11-19T14:00:00Z'), saida: null }, // entrou exatamente às 14h, ainda dentro
        { entrada: h('2026-11-19T15:00:00Z'), saida: h('2026-11-19T15:00:00Z') }, // saída no instante = fora
      ],
      agora,
    );
    const por = Object.fromEntries(pontos.map((p) => [p.em.slice(11, 16), p.ocupadas]));
    expect(por['13:00']).toBe(0);
    expect(por['14:00']).toBe(2);
    expect(por['15:00']).toBe(2);
    expect(pontos.at(-1)?.ocupadas).toBe(1);
  });
});

describe('montarFaturamentoDias', () => {
  it('preenche dias sem movimento com zero e soma as formas', () => {
    const dias = montarFaturamentoDias(
      [
        { dia: '2026-11-19', forma: 'PIX', total: 1000 },
        { dia: '2026-11-19', forma: 'DINHEIRO', total: 500 },
        { dia: '2026-11-17', forma: 'CREDITO', total: 2000 },
      ],
      '2026-11-19',
      3,
    );
    expect(dias).toEqual([
      { data: '2026-11-17', totalCentavos: 2000, porForma: { CREDITO: 2000 } },
      { data: '2026-11-18', totalCentavos: 0, porForma: {} },
      { data: '2026-11-19', totalCentavos: 1500, porForma: { PIX: 1000, DINHEIRO: 500 } },
    ]);
  });
});
