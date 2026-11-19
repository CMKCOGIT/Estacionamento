/** Contratos do módulo de veículos. */

export interface EstadiaAtual {
  sessaoId: string;
  numero: string;
  entradaEm: string;
  permanenciaMin: number;
  vaga: string | null;
  modalidade: 'AVULSO' | 'DIARIA';
  /** Valor acumulado até agora (mesma função de tarifa do caixa) menos o já pago. */
  valorEstimadoCentavos: number;
  pagoCentavos: number;
}

export interface VeiculoResumo {
  id: string;
  placa: string;
  placaEstrangeira: boolean;
  categoriaId: string;
  categoria: string;
  marca: string | null;
  modelo: string | null;
  cor: string | null;
  totalEstadias: number;
  ultimaVisitaEm: string | null;
  /** Preenchida quando o veículo está estacionado agora. */
  estadiaAtual: EstadiaAtual | null;
}

export interface EstatisticasVeiculo {
  totalEstadias: number;
  encerradas: number;
  canceladas: number;
  tempoTotalMin: number;
  tempoMedioMin: number | null;
  totalPagoCentavos: number;
  primeiraVisitaEm: string | null;
}

export interface VeiculoDetalhe extends VeiculoResumo {
  observacoes: string | null;
  criadoEm: string;
  atualizadoEm: string;
  estatisticas: EstatisticasVeiculo;
}

export interface Estadia {
  sessaoId: string;
  numero: string;
  /** Placa registrada NESTE ticket (preservada mesmo se o cadastro for corrigido). */
  placa: string;
  status: 'ABERTA' | 'ENCERRADA' | 'CANCELADA';
  modalidade: 'AVULSO' | 'DIARIA';
  categoria: string;
  vaga: string | null;
  entradaEm: string;
  saidaEm: string | null;
  permanenciaMin: number;
  valorFinalCentavos: number | null;
  pagoCentavos: number;
  operadorEntrada: string | null;
  operadorSaida: string | null;
  motivoCancelamento: string | null;
}

export interface PaginaEstadias {
  itens: Estadia[];
  proximaPagina: string | null;
}

export interface ListaVeiculos {
  itens: VeiculoResumo[];
  total: number;
  estacionadosAgora: number;
  proximaPagina: number | null;
}

export interface DadosVeiculo {
  placa: string;
  placaEstrangeira?: boolean;
  categoriaId: string;
  marca?: string | null;
  modelo?: string | null;
  cor?: string | null;
  observacoes?: string | null;
}

/** Resposta da consulta por placa. */
export interface ConsultaPlaca {
  placa: string;
  valida: boolean;
  veiculo: VeiculoDetalhe | null;
}
