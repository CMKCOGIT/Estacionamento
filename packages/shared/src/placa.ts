/** Padrão antigo (ABC1234) e Mercosul (ABC1D23) — mesmo CHECK do banco. */
const PADRAO_PLACA_BR = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
const PADRAO_PLACA_ESTRANGEIRA = /^[A-Z0-9]{4,10}$/;

/** Remove espaços, hífens e pontos e converte para maiúsculas: "abc-1d23" → "ABC1D23". */
export function normalizarPlaca(placa: string): string {
  return placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function placaValida(placa: string, estrangeira = false): boolean {
  const normalizada = normalizarPlaca(placa);
  return (estrangeira ? PADRAO_PLACA_ESTRANGEIRA : PADRAO_PLACA_BR).test(normalizada);
}

/** Exibição amigável: "ABC1234" → "ABC-1234"; Mercosul fica sem hífen. */
export function formatarPlaca(placa: string): string {
  const p = normalizarPlaca(placa);
  return /^[A-Z]{3}[0-9]{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}
