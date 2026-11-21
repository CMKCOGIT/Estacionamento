/**
 * Relatórios ADMINISTRATIVOS (operação): movimento, pátio, placas, ocupação,
 * vagas bloqueadas, funcionários e indicadores. Dados reais do banco local,
 * calculados no servidor. Ver docs/RELATORIOS.md.
 */
export type SituacaoSessao = 'ABERTA' | 'ENCERRADA' | 'CANCELADA';

export interface FiltroOperacional {
  de: string;
  ate: string;
  placa?: string;
  operadorId?: string;
  situacao?: SituacaoSessao;
}

export interface LinhaMovimento {
  id: string;
  numero: string;
  placa: string;
  categoria: string;
  vaga: string | null;
  situacao: SituacaoSessao;
  entradaEm: string;
  saidaEm: string | null;
  canceladoEm: string | null;
  permanenciaMin: number;
  valorFinalCentavos: number | null;
  operadorEntrada: string;
  operadorSaida: string | null;
}

export interface RelatorioMovimento {
  totais: { entradas: number; saidas: number; cancelados: number; abertos: number };
  porDia: { dia: string; entradas: number; saidas: number }[];
  itens: LinhaMovimento[];
  /** Há mais linhas além das mostradas (exporte por período menor). */
  truncado: boolean;
}

export interface VeiculoEstacionado {
  id: string;
  numero: string;
  placa: string;
  categoria: string;
  vaga: string | null;
  entradaEm: string;
  permanenciaMin: number;
  valorAcumuladoCentavos: number;
  pagoCentavos: number;
  operadorEntrada: string;
}

export interface HistoricoPlaca {
  placa: string;
  veiculo: {
    categoria: string;
    marca: string | null;
    modelo: string | null;
    cor: string | null;
    primeiraVisitaEm: string | null;
  } | null;
  resumo: {
    visitas: number;
    totalPagoCentavos: number;
    permanenciaMediaMin: number;
    ultimaVisitaEm: string | null;
  };
  estadias: LinhaMovimento[];
}

export interface RelatorioOcupacao {
  capacidade: number;
  porDia: {
    dia: string;
    mediaOcupadas: number;
    picoOcupadas: number;
    picoEm: string | null;
    taxaMedia: number;
  }[];
  /** Média de vagas ocupadas por hora do dia (0–23) no período. */
  perfilHorario: { hora: number; mediaOcupadas: number }[];
  porCategoria: { categoria: string; capacidade: number; mediaOcupadas: number; picoOcupadas: number }[];
}

export interface VagaBloqueada {
  id: string;
  codigo: string;
  setor: string | null;
  categoria: string;
  motivo: string | null;
  desde: string | null;
  bloqueadaPor: string | null;
  diasBloqueada: number;
}

export interface RelatorioBloqueios {
  atuais: VagaBloqueada[];
  historico: {
    em: string;
    vaga: string;
    acao: 'BLOQUEADA' | 'LIBERADA';
    motivo: string | null;
    usuario: string | null;
  }[];
}

export interface MovimentoFuncionario {
  usuarioId: string;
  nome: string;
  entradas: number;
  saidas: number;
  cancelamentos: number;
  pagamentos: number;
  recebidoCentavos: number;
  estornos: number;
  descontosCentavos: number;
  caixasAbertos: number;
}

export interface IndicadoresOperacionais {
  periodo: { de: string; ate: string; dias: number };
  entradas: number;
  saidas: number;
  cancelamentos: number;
  taxaCancelamento: number;
  entradasPorDia: number;
  permanenciaMediaMin: number;
  permanenciaMedianaMin: number;
  dentroDaToleranciaPct: number;
  rotatividade: number;
  ocupacaoMediaPct: number;
  ocupacaoPicoPct: number;
  horaDePico: number | null;
  ticketMedioCentavos: number;
  receitaPorVagaDiaCentavos: number;
  vagasBloqueadasAgora: number;
  veiculosAgora: number;
  porCategoria: { categoria: string; entradas: number; permanenciaMediaMin: number }[];
}

export interface OpcaoFuncionario {
  id: string;
  nome: string;
}
