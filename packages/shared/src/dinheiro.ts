const formatador = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 1850 → "R$ 18,50". Valores monetários circulam sempre como centavos inteiros. */
export function formatarCentavos(centavos: number): string {
  if (!Number.isInteger(centavos)) throw new TypeError('Valor em centavos deve ser inteiro');
  return formatador.format(centavos / 100);
}
