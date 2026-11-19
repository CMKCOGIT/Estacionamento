const formatador = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 1850 → "R$ 18,50". Valores monetários circulam sempre como centavos inteiros. */
export function formatarCentavos(centavos: number): string {
  if (!Number.isInteger(centavos)) throw new TypeError('Valor em centavos deve ser inteiro');
  return formatador.format(centavos / 100);
}

/**
 * Lê um valor digitado pelo operador e devolve em centavos.
 * Aceita "18", "18,5", "18,50", "1.234,56", "R$ 18,50" e "18.50". Inválido → null.
 */
export function lerCentavos(texto: string): number | null {
  let t = texto.replace(/R\$|\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [inteiro, frac = ''] = t.split('.');
  return Number(inteiro) * 100 + Number(frac.padEnd(2, '0'));
}

/** 1850 → "18,50" (para preencher campos de valor). */
export function centavosParaCampo(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',');
}
