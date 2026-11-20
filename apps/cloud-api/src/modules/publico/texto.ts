import { formatarCentavos, type RegraTarifa } from '@estacionamento/shared';

/** Linhas legíveis da tarifa para o cliente (tabela de preços do PWA). */
export function linhasPublicasDaRegra(r: RegraTarifa): string[] {
  const l: string[] = [];
  if (r.valorFixoCentavos !== null && r.valorFixoCentavos !== undefined) {
    l.push(`Preço fixo de ${formatarCentavos(r.valorFixoCentavos)} a cada 24h`);
  } else {
    l.push(`1ª hora: ${formatarCentavos(r.primeiraHoraCentavos)}`);
    l.push(`Hora adicional: ${formatarCentavos(r.horaAdicionalCentavos)}`);
    if (r.fracaoMin && r.fracaoCentavos !== null)
      l.push(`Depois da 1ª hora, fração de ${r.fracaoMin} min: ${formatarCentavos(r.fracaoCentavos)}`);
    if (r.carenciaMin) l.push(`Carência de ${r.carenciaMin} min em cada período`);
    if (r.diariaMaximaCentavos !== null)
      l.push(`Máximo de ${formatarCentavos(r.diariaMaximaCentavos)} a cada 24h`);
  }
  if (r.diariaCentavos !== null) l.push(`Diária: ${formatarCentavos(r.diariaCentavos)}`);
  if (r.toleranciaMin > 0) l.push(`Tolerância: até ${r.toleranciaMin} min sem cobrança`);
  return l;
}
