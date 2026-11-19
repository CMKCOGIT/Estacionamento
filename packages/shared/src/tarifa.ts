/**
 * Cálculo de tarifa — função ÚNICA usada pelo servidor local (caixa e
 * dashboard), pela nuvem e pelo PWA, para que o valor mostrado ao cliente seja
 * exatamente o cobrado. Algoritmo descrito em docs/ARQUITETURA.md §8.3.
 * Valores em centavos inteiros; tempo em minutos inteiros (arredondado para cima).
 */

export interface RegraTarifa {
  toleranciaMin: number;
  primeiraHoraCentavos: number;
  horaAdicionalCentavos: number;
  fracaoMin: number | null;
  fracaoCentavos: number | null;
  diariaMaximaCentavos: number | null;
  diariaCentavos: number | null;
}

export type Modalidade = 'AVULSO' | 'DIARIA';

const MINUTOS_DIA = 24 * 60;

/** Minutos de permanência, sempre arredondados para cima (61 s = 2 min). */
export function minutosDePermanencia(entrada: Date, agora: Date): number {
  const ms = agora.getTime() - entrada.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}

/** Custo de um período de até 24h, sem considerar teto nem tolerância. */
function custoHoras(regra: RegraTarifa, minutos: number): number {
  if (minutos <= 0) return 0;
  let valor = regra.primeiraHoraCentavos;
  const resto = minutos - 60;
  if (resto <= 0) return valor;
  valor += Math.floor(resto / 60) * regra.horaAdicionalCentavos;
  const sobra = resto % 60;
  if (sobra > 0) {
    valor +=
      regra.fracaoMin && regra.fracaoCentavos !== null
        ? Math.min(Math.ceil(sobra / regra.fracaoMin) * regra.fracaoCentavos, regra.horaAdicionalCentavos)
        : regra.horaAdicionalCentavos;
  }
  return valor;
}

export function calcularTarifa(
  regra: RegraTarifa,
  minutos: number,
  modalidade: Modalidade = 'AVULSO',
): number {
  if (!Number.isInteger(minutos) || minutos < 0) throw new RangeError('minutos deve ser inteiro >= 0');
  if (minutos <= regra.toleranciaMin) return 0;

  if (modalidade === 'DIARIA') {
    if (regra.diariaCentavos === null) throw new Error('Esta tarifa não tem modo diária');
    return Math.ceil(minutos / MINUTOS_DIA) * regra.diariaCentavos;
  }

  const dias = Math.floor(minutos / MINUTOS_DIA);
  const resto = minutos % MINUTOS_DIA;
  const teto = regra.diariaMaximaCentavos;
  const custoDiaCompleto = teto ?? custoHoras(regra, MINUTOS_DIA);
  const custoResto = teto === null ? custoHoras(regra, resto) : Math.min(custoHoras(regra, resto), teto);
  return dias * custoDiaCompleto + custoResto;
}
