/**
 * Contratos das integrações com equipamentos (docs/ARQUITETURA.md §2.4).
 *
 * As regras de negócio dependem SOMENTE destas interfaces. Na v1 todas as
 * implementações são manuais/vazias; câmeras LPR, sensores, cancelas e
 * impressoras entram depois como novas implementações, sem alterar os módulos.
 */

export interface LeituraPlaca {
  placa: string;
  confianca: number; // 0 a 1
  capturadaEm: Date;
  imagemUrl?: string;
}

/** Leitor de placas (LPR). v1: o operador digita a placa. */
export interface PlateReader {
  readonly nome: string;
  /** Última leitura disponível no posto, ou null se não houver leitor. */
  lerPlaca(postoId: string): Promise<LeituraPlaca | null>;
}

export type EstadoVaga = 'LIVRE' | 'OCUPADA' | 'DESCONHECIDO';

/** Sensor de ocupação de vaga. v1: o operador escolhe a vaga. */
export interface OccupancySensor {
  readonly nome: string;
  estadoDaVaga(vagaId: string): Promise<EstadoVaga>;
}

/** Cancela. v1: não existe — chamadas não fazem nada. */
export interface Gate {
  readonly nome: string;
  abrir(postoId: string, motivo: 'ENTRADA' | 'SAIDA'): Promise<void>;
}

export interface DadosImpressaoTicket {
  numero: string;
  placa: string;
  entradaEm: Date;
  vaga?: string;
  linkCliente: string;
}

/** Impressora de ticket. v1: o QR é exibido na tela, nada é impresso. */
export interface TicketPrinter {
  readonly nome: string;
  imprimirTicket(postoId: string, dados: DadosImpressaoTicket): Promise<void>;
}

export interface Integracoes {
  leitorPlaca: PlateReader;
  sensorOcupacao: OccupancySensor;
  cancela: Gate;
  impressora: TicketPrinter;
}
