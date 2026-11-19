/**
 * Cálculo de uma estadia: entrada + agora (ou saída) + tarifa gravada no
 * ticket → permanência, valor acumulado, ajustes, saldo e a próxima cobrança.
 *
 * É a ÚNICA forma de obter o valor de um ticket no backend: lista de
 * estacionados, tela de saída, encerramento, veículo, painel e demonstração
 * passam por aqui. Assim o valor mostrado durante a permanência é exatamente
 * o que será cobrado na saída naquele mesmo instante.
 */
import type { ItemCalculo, Modalidade, RegraTarifa } from '@estacionamento/shared';
import { calcularTarifa, detalharTarifa, MINUTOS_DIA, minutosDePermanencia } from './motor.js';

export class ErroCalculo extends Error {
  constructor(
    readonly codigo: 'SEM_DIARIA' | 'DESCONTO_MAIOR_QUE_VALOR' | 'VALOR_INVALIDO',
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroCalculo';
  }
}

export interface DadosEstadia {
  entradaEm: Date;
  /** Agora (estadia em andamento) ou a saída. Sempre o relógio do banco. */
  fim: Date;
  /** A regra gravada no ticket na entrada — nunca a tabela atual. */
  regra: RegraTarifa;
  modalidade: Modalidade;
  pagoCentavos?: number;
  descontoCentavos?: number;
  acrescimoCentavos?: number;
  /** Calcula quando o valor sobe de novo (só faz sentido com o ticket aberto). */
  emAndamento?: boolean;
}

export interface ProximaCobrancaCalculada {
  /** Instante em que o valor passa a ser `valorCentavos`. */
  em: Date;
  permanenciaMin: number;
  valorCentavos: number;
}

export interface ResultadoEstadia {
  permanenciaMin: number;
  /** Valor pela tarifa, antes de desconto/acréscimo. */
  valorCalculadoCentavos: number;
  itens: ItemCalculo[];
  descontoCentavos: number;
  acrescimoCentavos: number;
  valorFinalCentavos: number;
  pagoCentavos: number;
  /** final − pago, nunca negativo. */
  aPagarCentavos: number;
  /** Pago além do valor final (precisa de estorno antes de encerrar). */
  excedentePagoCentavos: number;
  proximaCobranca: ProximaCobrancaCalculada | null;
}

const inteiroNaoNegativo = (v: number) => Number.isInteger(v) && v >= 0;

/**
 * Primeiro minuto de permanência em que o valor sobe. O valor nunca diminui
 * com o tempo (garantido pelos testes), então a busca binária é exata. Toda
 * regra sobe em no máximo 24h (diária, teto ou hora seguinte).
 */
export function proximoMinutoDeCobranca(
  regra: RegraTarifa,
  minutos: number,
  modalidade: Modalidade,
): number | null {
  const atual = calcularTarifa(regra, minutos, modalidade);
  let baixo = minutos + 1;
  let alto = minutos + MINUTOS_DIA + 1;
  if (calcularTarifa(regra, alto, modalidade) <= atual) return null;
  // Menor minuto em [baixo, alto] com valor maior que o atual
  while (baixo < alto) {
    const meio = Math.floor((baixo + alto) / 2);
    if (calcularTarifa(regra, meio, modalidade) > atual) alto = meio;
    else baixo = meio + 1;
  }
  return baixo;
}

export function calcularEstadia(d: DadosEstadia): ResultadoEstadia {
  const pago = d.pagoCentavos ?? 0;
  const desconto = d.descontoCentavos ?? 0;
  const acrescimo = d.acrescimoCentavos ?? 0;
  if (![pago, desconto, acrescimo].every(inteiroNaoNegativo)) {
    throw new ErroCalculo('VALOR_INVALIDO', 'Valores em centavos devem ser inteiros e não negativos.');
  }
  if (d.modalidade === 'DIARIA' && d.regra.diariaCentavos === null) {
    throw new ErroCalculo('SEM_DIARIA', 'Esta tarifa não tem modalidade diária.');
  }

  const permanenciaMin = minutosDePermanencia(d.entradaEm, d.fim);
  const detalhe = detalharTarifa(d.regra, permanenciaMin, d.modalidade);
  const final = detalhe.totalCentavos - desconto + acrescimo;
  if (final < 0) {
    throw new ErroCalculo(
      'DESCONTO_MAIOR_QUE_VALOR',
      'O desconto não pode ser maior que o valor da estadia.',
    );
  }

  let proxima: ProximaCobrancaCalculada | null = null;
  if (d.emAndamento) {
    const m = proximoMinutoDeCobranca(d.regra, permanenciaMin, d.modalidade);
    if (m !== null) {
      // A permanência vira `m` minutos assim que passa de (m − 1) minutos completos
      proxima = {
        em: new Date(d.entradaEm.getTime() + (m - 1) * 60_000 + 1),
        permanenciaMin: m,
        valorCentavos: calcularTarifa(d.regra, m, d.modalidade) - desconto + acrescimo,
      };
    }
  }

  return {
    permanenciaMin,
    valorCalculadoCentavos: detalhe.totalCentavos,
    itens: detalhe.itens,
    descontoCentavos: desconto,
    acrescimoCentavos: acrescimo,
    valorFinalCentavos: final,
    pagoCentavos: pago,
    aPagarCentavos: Math.max(0, final - pago),
    excedentePagoCentavos: Math.max(0, pago - final),
    proximaCobranca: proxima,
  };
}
