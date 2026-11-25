/** Contratos dos relatórios financeiros (dados reais do banco, calculados no servidor). */
import type { CaixaResumo, Movimentacao, PagamentoRegistro, Pendencia } from './financeiro.js';
import type { SessaoDetalhe } from './sessoes.js';

export type Agrupamento = 'DIA' | 'SEMANA' | 'MES';

export interface ValoresFaturamento {
  /** Pagamentos registrados (inclusive os estornados depois). */
  recebidoCentavos: number;
  quantidadePagamentos: number;
  /** Estornos feitos no período. */
  estornadoCentavos: number;
  quantidadeEstornos: number;
  /** Recebido − estornado: o faturamento. */
  liquidoCentavos: number;
  trocoCentavos: number;
  /** Tickets encerrados (pela data da saída). */
  ticketsEncerrados: number;
  ticketsSemCobranca: number;
  /** Soma do valor final dos tickets encerrados. */
  faturadoTicketsCentavos: number;
  descontosCentavos: number;
}

export interface PontoFaturamento extends ValoresFaturamento {
  /** Primeiro e último dia do grupo, dentro do período pedido (AAAA-MM-DD, fuso do estacionamento). */
  inicio: string;
  fim: string;
  /** Líquido por forma de pagamento. */
  porForma: { forma: string; liquidoCentavos: number }[];
}

export interface TotaisFaturamento extends ValoresFaturamento {
  dias: number;
  mediaDiariaCentavos: number;
  ticketMedioCentavos: number | null;
}

export interface RelatorioFaturamento {
  de: string;
  ate: string;
  agrupar: Agrupamento;
  pontos: PontoFaturamento[];
  totais: TotaisFaturamento;
  /** Mesmo número de dias, imediatamente antes. */
  anterior: { de: string; ate: string; totais: TotaisFaturamento };
  /** Variação do líquido em relação ao período anterior (null se o anterior foi zero). */
  variacaoLiquidoPct: number | null;
  nomesFormas: Record<string, string>;
  /** Receita líquida por tipo de veículo no período (carro, moto...). */
  porCategoria: {
    codigo: string;
    nome: string;
    liquidoCentavos: number;
    pagamentos: number;
    tickets: number;
  }[];
}

export interface LinhaForma {
  forma: string;
  nome: string;
  quantidade: number;
  recebidoCentavos: number;
  estornadoCentavos: number;
  quantidadeEstornos: number;
  liquidoCentavos: number;
  /** Participação no líquido total (0–100, uma casa). */
  percentual: number;
  mediaPorPagamentoCentavos: number | null;
  trocoCentavos: number;
  parcelasMedia: number | null;
}

export interface RelatorioFormas {
  de: string;
  ate: string;
  formas: LinhaForma[];
  totais: {
    quantidade: number;
    recebidoCentavos: number;
    estornadoCentavos: number;
    liquidoCentavos: number;
  };
}

export interface RelatorioPendentes {
  calculadoEm: string;
  quantidade: number;
  totalCentavos: number;
  /** Por tempo de permanência. */
  faixas: { rotulo: string; quantidade: number; totalCentavos: number }[];
  itens: Pendencia[];
}

export interface RelatorioFechamentos {
  de: string;
  ate: string;
  itens: CaixaResumo[];
  totais: {
    quantidade: number;
    conferidos: number;
    comSobra: number;
    comFalta: number;
    sobraCentavos: number;
    faltaCentavos: number;
    /** sobras − faltas */
    diferencaLiquidaCentavos: number;
    recebidoCentavos: number;
  };
}

export interface EventoHistorico {
  acao: string;
  em: string;
  usuario: string | null;
  motivo: string | null;
}

/** Tudo sobre uma movimentação (ou um pagamento): de onde veio, a que se refere e quem fez. */
export interface DetalheMovimentacao {
  movimentacao: Movimentacao | null;
  pagamento: PagamentoRegistro | null;
  ticket: SessaoDetalhe | null;
  caixa: CaixaResumo | null;
  /** Outras movimentações do mesmo pagamento/ticket (ex.: recebimento e estorno). */
  relacionadas: Movimentacao[];
  historico: EventoHistorico[];
}
