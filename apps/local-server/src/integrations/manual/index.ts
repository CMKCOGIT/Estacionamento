import type { Gate, OccupancySensor, PlateReader, TicketPrinter } from '../tipos.js';

/** v1: não há câmera; a placa vem digitada pelo operador. */
export const leitorPlacaManual: PlateReader = {
  nome: 'manual',
  lerPlaca: async () => null,
};

/** v1: não há sensor; a ocupação vem das sessões abertas no banco. */
export const sensorOcupacaoManual: OccupancySensor = {
  nome: 'manual',
  estadoDaVaga: async () => 'DESCONHECIDO',
};

/** v1: não há cancela. */
export const cancelaInexistente: Gate = {
  nome: 'nenhuma',
  abrir: async () => undefined,
};

/** v1: o QR Code é exibido na tela do operador / Tela do Cliente. */
export const impressoraTela: TicketPrinter = {
  nome: 'tela',
  imprimirTicket: async () => undefined,
};
