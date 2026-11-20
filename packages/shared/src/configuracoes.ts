/**
 * Política de acesso do cliente ao próprio ticket (link/QR Code do app).
 * O link nunca expira enquanto o veículo está no estacionamento; depois da
 * saída, continua funcionando por `horasAposSaida` horas (0 = encerra na
 * saída). Ticket cancelado: o acesso termina na hora.
 */
export interface PoliticaAcessoCliente {
  horasAposSaida: number;
}

export const POLITICA_ACESSO_PADRAO: PoliticaAcessoCliente = { horasAposSaida: 24 };
/** Limite: uma semana (o link dá acesso à placa; não deve valer para sempre). */
export const HORAS_APOS_SAIDA_MAX = 168;
