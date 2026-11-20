import type { TipoMovimentacao } from '@estacionamento/shared';

export const ROTULO_MOVIMENTACAO: Record<TipoMovimentacao, string> = {
  ABERTURA: 'Abertura (troco)',
  SUPRIMENTO: 'Suprimento',
  SANGRIA: 'Sangria',
  RECEBIMENTO: 'Recebimento',
  ESTORNO: 'Estorno',
  AJUSTE: 'Ajuste',
};

/** Hoje no fuso do navegador (o mesmo do estacionamento), "AAAA-MM-DD". */
export function hojeLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
