/** Contratos do módulo financeiro: pagamentos, pendências, movimentações, caixas e resumo diário. */
import type { PagamentoResumo, SessaoDetalhe } from './sessoes.js';

/** Pagamento registrado com o veículo ainda no estacionamento (antecipado ou parcial). */
export interface PedidoPagamento {
  forma: string;
  /** null = o valor em aberto agora. */
  valorCentavos: number | null;
  /** Só dinheiro: valor entregue pelo cliente (calcula o troco). */
  valorRecebidoCentavos?: number | null;
  autorizacao?: string | null;
  parcelas?: number;
  /** UUID gerado pela tela uma vez por operação: reenvios não duplicam o pagamento. */
  chaveIdempotencia: string;
  /** Confirma que é mesmo outro pagamento igual a um registrado há pouco. */
  confirmarDuplicidade?: boolean;
}

export interface ResultadoPagamento {
  pagamento: PagamentoResumo;
  trocoCentavos: number;
  sessao: SessaoDetalhe;
  /** true = esta operação já tinha sido registrada (reenvio); nada foi gravado de novo. */
  repetido: boolean;
}

export interface PagamentoRegistro {
  id: string;
  sessaoId: string;
  ticketNumero: string;
  placa: string;
  /** Situação do ticket agora. */
  sessaoStatus: 'ABERTA' | 'ENCERRADA' | 'CANCELADA';
  forma: string;
  formaNome: string;
  valorCentavos: number;
  valorRecebidoCentavos: number | null;
  trocoCentavos: number;
  parcelas: number;
  autorizacao: string | null;
  status: 'CONFIRMADO' | 'ESTORNADO';
  registradoEm: string;
  registradoPor: string | null;
  caixaId: string | null;
  posto: string | null;
  estornadoEm: string | null;
  estornadoPor: string | null;
  motivoEstorno: string | null;
}

export interface FiltroPeriodo {
  /** "AAAA-MM-DD" no fuso do estacionamento (inclusive). */
  de?: string;
  ate?: string;
}

export interface ListaPagamentos {
  itens: PagamentoRegistro[];
  totais: { quantidade: number; confirmadosCentavos: number; estornadosCentavos: number };
  proximaPagina: number | null;
}

/** Ticket aberto com valor a receber (valor acumulado − já pago). */
export interface Pendencia {
  sessaoId: string;
  numero: string;
  placa: string;
  vaga: string | null;
  categoria: string;
  entradaEm: string;
  permanenciaMin: number;
  valorAcumuladoCentavos: number;
  pagoCentavos: number;
  aPagarCentavos: number;
  /** Já pagou uma parte. */
  parcial: boolean;
}

export interface ListaPendencias {
  calculadoEm: string;
  quantidade: number;
  totalCentavos: number;
  itens: Pendencia[];
}

export type TipoMovimentacao = 'ABERTURA' | 'SUPRIMENTO' | 'SANGRIA' | 'RECEBIMENTO' | 'ESTORNO' | 'AJUSTE';

export interface Movimentacao {
  id: string;
  tipo: TipoMovimentacao;
  direcao: 'ENTRADA' | 'SAIDA';
  valorCentavos: number;
  forma: string;
  formaNome: string;
  caixaId: string | null;
  posto: string | null;
  registradoEm: string;
  registradoPor: string | null;
  descricao: string | null;
  sessaoId: string | null;
  ticketNumero: string | null;
  placa: string | null;
  pagamentoId: string | null;
}

export interface ListaMovimentacoes {
  itens: Movimentacao[];
  totais: { entradasCentavos: number; saidasCentavos: number };
  proximaPagina: number | null;
}

export interface ValoresPorForma {
  forma: string;
  nome: string;
  entradasCentavos: number;
  saidasCentavos: number;
  saldoCentavos: number;
}

export interface CaixaResumo {
  id: string;
  posto: string;
  operador: string;
  operadorId: string;
  status: 'ABERTO' | 'FECHADO';
  abertoEm: string;
  fechadoEm: string | null;
  fechadoPor: string | null;
  saldoInicialCentavos: number;
  /** Dinheiro que deve estar na gaveta (calculado agora, ou o do fechamento). null = oculto (conferência às cegas). */
  dinheiroEsperadoCentavos: number | null;
  saldoContadoCentavos: number | null;
  diferencaCentavos: number | null;
  observacao: string | null;
  quantidadeRecebimentos: number;
  /** null = oculto para o operador (conferência às cegas). */
  recebidoCentavos: number | null;
  estornadoCentavos: number | null;
  /** true = valores de conferência ocultos para quem consulta (operador). */
  conferenciaOculta?: boolean;
  sangriasCentavos: number;
  suprimentosCentavos: number;
  /** Correções feitas depois do fechamento (entradas − saídas). O fechamento original não muda. */
  ajustesCentavos: number;
  quantidadeAjustes: number;
  /** Diferença do fechamento somada às correções (null se aberto). */
  diferencaCorrigidaCentavos: number | null;
  porForma: ValoresPorForma[];
}

/** Correção de um caixa já fechado (vira uma movimentação AJUSTE, com motivo). */
export interface PedidoCorrecaoCaixa {
  direcao: 'ENTRADA' | 'SAIDA';
  valorCentavos: number;
  formaCodigo: string;
  motivo: string;
}

export interface CaixaDetalhe extends CaixaResumo {
  movimentacoes: Movimentacao[];
}

export interface PedidoMovimentacaoCaixa {
  tipo: 'SANGRIA' | 'SUPRIMENTO';
  valorCentavos: number;
  descricao: string;
}

export interface ResumoFinanceiroDia {
  data: string;
  /** Pagamentos registrados no dia (inclusive os estornados depois). */
  recebidoCentavos: number;
  quantidadePagamentos: number;
  /** Estornos feitos no dia. */
  estornadoCentavos: number;
  quantidadeEstornos: number;
  /** recebido − estornado. */
  liquidoCentavos: number;
  trocoCentavos: number;
  ticketsEncerrados: number;
  ticketsSemCobranca: number;
  ticketMedioCentavos: number | null;
  descontosCentavos: number;
  porForma: {
    forma: string;
    nome: string;
    quantidade: number;
    recebidoCentavos: number;
    estornadoCentavos: number;
    liquidoCentavos: number;
  }[];
  porHora: { hora: number; quantidade: number; recebidoCentavos: number }[];
  caixas: CaixaResumo[];
  /** Só no dia de hoje: tickets abertos com valor a receber agora. */
  pendentes: { quantidade: number; totalCentavos: number } | null;
}
