/**
 * Motor de tarifa: transforma uma regra e um tempo de permanência em valor,
 * item a item. Valores em centavos inteiros; tempo em minutos inteiros
 * (a permanência é arredondada para cima, ao minuto).
 *
 * Só os backends usam este pacote. As telas recebem os valores prontos.
 */
import type {
  CondicaoEspecial,
  DetalheCalculo,
  ItemCalculo,
  Modalidade,
  RegraTarifa,
} from '@estacionamento/shared';

export const MINUTOS_DIA = 24 * 60;

/** Minutos de permanência, sempre arredondados para cima (61 s = 2 min). */
export function minutosDePermanencia(entrada: Date, agora: Date): number {
  const ms = agora.getTime() - entrada.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}

/** Quantos períodos de `periodo` minutos são cobrados em `minutos`, com carência. */
function periodosCobrados(minutos: number, periodo: number, carencia: number): number {
  return minutos <= carencia ? 0 : Math.ceil((minutos - carencia) / periodo);
}

const item = (
  descricao: string,
  quantidade: number,
  unitario: number,
  total = quantidade * unitario,
): ItemCalculo => ({
  descricao,
  quantidade,
  unitarioCentavos: unitario,
  totalCentavos: total,
});
const soma = (itens: ItemCalculo[]) => itens.reduce((t, i) => t + i.totalCentavos, 0);

/** Itens de um período de até 24h, sem teto nem tolerância. */
function itensHoras(regra: RegraTarifa, minutos: number): ItemCalculo[] {
  if (minutos <= 0) return [];
  const itens = [item('1ª hora', 1, regra.primeiraHoraCentavos)];
  const resto = minutos - 60;
  if (resto <= 0) return itens;
  const carencia = regra.carenciaMin ?? 0;

  if (!regra.fracaoMin || regra.fracaoCentavos === null) {
    const horas = periodosCobrados(resto, 60, carencia);
    if (horas > 0) itens.push(item('Hora adicional', horas, regra.horaAdicionalCentavos));
    return itens;
  }

  const horas = Math.floor(resto / 60);
  if (horas > 0) itens.push(item('Hora adicional', horas, regra.horaAdicionalCentavos));
  const fracoes = periodosCobrados(resto % 60, regra.fracaoMin, carencia);
  if (fracoes > 0) {
    const bruto = fracoes * regra.fracaoCentavos;
    const limitado = Math.min(bruto, regra.horaAdicionalCentavos);
    itens.push(
      item(
        `Fração de ${regra.fracaoMin} min${limitado < bruto ? ' (limitada ao valor da hora adicional)' : ''}`,
        fracoes,
        regra.fracaoCentavos,
        limitado,
      ),
    );
  }
  return itens;
}

/** Cálculo item a item (o que é mostrado no recibo e gravado na sessão). */
export function detalharTarifa(
  regra: RegraTarifa,
  minutos: number,
  modalidade: Modalidade = 'AVULSO',
): DetalheCalculo {
  if (!Number.isInteger(minutos) || minutos < 0) throw new RangeError('minutos deve ser inteiro >= 0');
  if (minutos <= regra.toleranciaMin) {
    const itens = minutos > 0 ? [item(`Dentro da tolerância de ${regra.toleranciaMin} min`, 1, 0)] : [];
    return { totalCentavos: 0, itens };
  }

  if (modalidade === 'DIARIA') {
    if (regra.diariaCentavos === null) throw new Error('Esta tarifa não tem modo diária');
    const itens = [item('Diária (24h)', Math.ceil(minutos / MINUTOS_DIA), regra.diariaCentavos)];
    return { totalCentavos: soma(itens), itens };
  }

  const fixo = regra.valorFixoCentavos ?? null;
  if (fixo !== null) {
    const itens = [item('Preço fixo (por 24h)', Math.ceil(minutos / MINUTOS_DIA), fixo)];
    return { totalCentavos: soma(itens), itens };
  }

  const dias = Math.floor(minutos / MINUTOS_DIA);
  const resto = minutos % MINUTOS_DIA;
  const teto = regra.diariaMaximaCentavos;
  const itens: ItemCalculo[] = [];
  if (dias > 0) {
    itens.push(
      teto !== null
        ? item('Diária máxima (24h completas)', dias, teto)
        : item('Período de 24h completo', dias, soma(itensHoras(regra, MINUTOS_DIA))),
    );
  }
  const doResto = itensHoras(regra, resto);
  if (teto !== null && soma(doResto) > teto) itens.push(item('Diária máxima (limite do período)', 1, teto));
  else itens.push(...doResto);
  return { totalCentavos: soma(itens), itens };
}

export function calcularTarifa(
  regra: RegraTarifa,
  minutos: number,
  modalidade: Modalidade = 'AVULSO',
): number {
  return detalharTarifa(regra, minutos, modalidade).totalCentavos;
}

/**
 * Problemas de uma regra (mesmas regras do banco), para avisar no formulário
 * antes de salvar. Lista vazia = válida.
 */
export function problemasDaRegra(r: RegraTarifa): string[] {
  const p: string[] = [];
  const valores = [
    r.primeiraHoraCentavos,
    r.horaAdicionalCentavos,
    r.fracaoCentavos,
    r.diariaMaximaCentavos,
    r.diariaCentavos,
    r.valorFixoCentavos,
  ];
  if (valores.some((v) => v !== null && v !== undefined && (!Number.isInteger(v) || v < 0)))
    p.push('Os valores não podem ser negativos.');
  if (!Number.isInteger(r.toleranciaMin) || r.toleranciaMin < 0 || r.toleranciaMin > 240)
    p.push('A tolerância deve ficar entre 0 e 240 minutos.');
  if ((r.fracaoMin === null) !== (r.fracaoCentavos === null))
    p.push('Informe a duração e o valor da fração (ou deixe os dois em branco).');
  if (r.fracaoMin !== null && (r.fracaoMin < 1 || r.fracaoMin > 59))
    p.push('A fração deve ter de 1 a 59 minutos.');
  const periodo = r.fracaoMin ?? 60;
  const carencia = r.carenciaMin ?? 0;
  if (!Number.isInteger(carencia) || carencia < 0 || carencia >= periodo)
    p.push(`A carência deve ser menor que o período cobrado (${periodo} min).`);
  if (r.diariaMaximaCentavos !== null && r.diariaMaximaCentavos < r.primeiraHoraCentavos)
    p.push('A diária máxima não pode ser menor que a 1ª hora.');
  return p;
}

// Tarifas especiais: quando se aplicam automaticamente

const minutosDoTexto = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/**
 * A condição vale para uma entrada no dia da semana (0 = domingo) e minuto do
 * dia informados — ambos no fuso do estacionamento.
 */
export function especialSeAplica(c: CondicaoEspecial, diaSemana: number, minutoDoDia: number): boolean {
  if (c.horaInicio && c.horaFim) {
    const ini = minutosDoTexto(c.horaInicio);
    const fim = minutosDoTexto(c.horaFim);
    const dentro =
      ini <= fim ? minutoDoDia >= ini && minutoDoDia < fim : minutoDoDia >= ini || minutoDoDia < fim;
    if (!dentro) return false;
    // Janela que atravessa a meia-noite: a madrugada pertence ao dia em que a janela começou
    if (ini > fim && minutoDoDia < fim) diaSemana = (diaSemana + 6) % 7;
  }
  return c.diasSemana === null || (c.diasSemana & (1 << diaSemana)) !== 0;
}
