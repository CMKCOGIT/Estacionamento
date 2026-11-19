/**
 * Contratos de tarifa (tipos) e textos para exibição.
 *
 * O CÁLCULO não fica aqui: ele está em `@estacionamento/calculo`, usado só
 * pelos backends (servidor local e, no futuro, a API da nuvem). As telas
 * recebem os valores já calculados pela API.
 */
import { formatarCentavos } from './dinheiro.js';

export interface RegraTarifa {
  toleranciaMin: number;
  primeiraHoraCentavos: number;
  horaAdicionalCentavos: number;
  fracaoMin: number | null;
  fracaoCentavos: number | null;
  diariaMaximaCentavos: number | null;
  diariaCentavos: number | null;
  /**
   * Regra de arredondamento depois da 1ª hora: minutos de carência em cada
   * período (hora ou fração). 0 = arredonda para cima (qualquer minuto iniciado
   * cobra o período). Ex.: carência 5 com fração de 15 min → 1h05 não cobra
   * fração; 1h06 cobra uma.
   */
  carenciaMin?: number;
  /** Preço fixo por período de 24h (tarifa especial de valor único). Substitui hora e fração. */
  valorFixoCentavos?: number | null;
}

export type Modalidade = 'AVULSO' | 'DIARIA';

export interface ItemCalculo {
  descricao: string;
  quantidade: number;
  unitarioCentavos: number;
  totalCentavos: number;
}

export interface DetalheCalculo {
  totalCentavos: number;
  itens: ItemCalculo[];
}

/** Texto curto da tarifa, para o operador e o cliente conferirem. */
export function descreverRegra(r: RegraTarifa, modalidade: Modalidade = 'AVULSO'): string {
  if (modalidade === 'DIARIA') return `Diária ${formatarCentavos(r.diariaCentavos ?? 0)} por 24h`;
  const partes: string[] = [];
  if (r.valorFixoCentavos !== null && r.valorFixoCentavos !== undefined) {
    partes.push(`preço fixo ${formatarCentavos(r.valorFixoCentavos)} por 24h`);
  } else {
    partes.push(`1ª hora ${formatarCentavos(r.primeiraHoraCentavos)}`);
    partes.push(`hora adicional ${formatarCentavos(r.horaAdicionalCentavos)}`);
    if (r.fracaoMin && r.fracaoCentavos !== null)
      partes.push(`fração de ${r.fracaoMin} min ${formatarCentavos(r.fracaoCentavos)}`);
    if (r.carenciaMin) partes.push(`carência de ${r.carenciaMin} min por período`);
    if (r.diariaMaximaCentavos !== null)
      partes.push(`máximo ${formatarCentavos(r.diariaMaximaCentavos)}/24h`);
  }
  if (r.toleranciaMin > 0) partes.push(`tolerância ${r.toleranciaMin} min`);
  const texto = partes.join(' · ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// ---------------------------------------------------------------------------
// Tarifas especiais: quando se aplicam automaticamente
// ---------------------------------------------------------------------------

export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;

export interface CondicaoEspecial {
  /** Máscara de bits: 1 = domingo, 2 = segunda ... 64 = sábado. null = todos os dias. */
  diasSemana: number | null;
  /** Janela do horário de ENTRADA, "HH:MM". Se início > fim, atravessa a meia-noite. null = o dia todo. */
  horaInicio: string | null;
  horaFim: string | null;
}

/** "Seg a Sex, 18:00–23:59" */
export function descreverCondicao(c: CondicaoEspecial): string {
  const dias =
    c.diasSemana === null || c.diasSemana === 127
      ? 'Todos os dias'
      : c.diasSemana === 62
        ? 'Seg a Sex'
        : c.diasSemana === 65
          ? 'Sáb e Dom'
          : DIAS_SEMANA.filter((_, i) => c.diasSemana! & (1 << i)).join(', ');
  return c.horaInicio && c.horaFim ? `${dias}, entrada das ${c.horaInicio} às ${c.horaFim}` : dias;
}
