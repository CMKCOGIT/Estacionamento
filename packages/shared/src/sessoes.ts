/** Contratos do controle de entrada e saída (sessões de estacionamento) e do caixa. */
import type { ItemCalculo, Modalidade } from './tarifa.js';

export interface PedidoEntrada {
  placa: string;
  placaEstrangeira?: boolean;
  /** Obrigatória se o veículo ainda não estiver cadastrado. */
  categoriaId?: string;
  /** Vazio = o sistema escolhe a primeira vaga livre da categoria. */
  vagaId?: string | null;
  modalidade?: Modalidade;
  postoId?: string | null;
  /** Dados opcionais para o cadastro automático do veículo. */
  marca?: string | null;
  modelo?: string | null;
  cor?: string | null;
  /** Tarifa especial escolhida pelo operador. Vazio = padrão (ou especial automática do horário). */
  tarifaRegraId?: string | null;
}

export interface CalculoEstadia {
  /** Instante usado no cálculo (agora, ou a saída se já encerrada). */
  calculadoEm: string;
  permanenciaMin: number;
  valorCalculadoCentavos: number;
  pagoCentavos: number;
  /** Quanto falta pagar = calculado − pago (nunca negativo). */
  aPagarCentavos: number;
  /** Faixa da tarifa aplicada (texto curto para o operador). */
  tarifa: string;
  /** Como o valor foi formado (1ª hora, horas adicionais, frações, teto...). */
  itens: ItemCalculo[];
  /** Ticket aberto: quando o valor sobe de novo e para quanto. null = não sobe em 24h ou já encerrado. */
  proximaCobranca: { em: string; permanenciaMin: number; valorCentavos: number } | null;
}

export interface SessaoDetalhe {
  id: string;
  numero: string;
  status: 'ABERTA' | 'ENCERRADA' | 'CANCELADA';
  placa: string;
  veiculoId: string;
  categoriaId: string;
  categoria: string;
  vagaId: string | null;
  vaga: string | null;
  modalidade: Modalidade;
  entradaEm: string;
  saidaEm: string | null;
  operadorEntrada: string | null;
  operadorSaida: string | null;
  valorFinalCentavos: number | null;
  /** Tarifa gravada no ticket na entrada: nome, versão da tabela e se foi especial. */
  tarifaAplicada: { nome: string; tabelaVersao: number | null; tipo: 'PADRAO' | 'ESPECIAL' };
  calculo: CalculoEstadia;
  pagamentos: PagamentoResumo[];
  versao: number;
}

export interface PagamentoResumo {
  id: string;
  forma: string;
  formaNome: string;
  valorCentavos: number;
  valorRecebidoCentavos: number | null;
  trocoCentavos: number;
  status: 'CONFIRMADO' | 'ESTORNADO';
  registradoEm: string;
}

export interface AcessoCliente {
  /** Link individual do cliente (o token vai depois do #, nunca é enviado ao servidor web). */
  link: string;
  /** QR Code em SVG, gerado no servidor local (funciona sem internet). */
  qrSvg: string;
  /** Mensagem pronta para compartilhar (WhatsApp etc.). */
  mensagem: string;
}

export interface ResultadoEntrada {
  sessao: SessaoDetalhe;
  veiculoCadastradoAgora: boolean;
  acesso: AcessoCliente;
}

export interface PagamentoSaida {
  forma: string;
  /** null = completa automaticamente o que faltar (no máximo um pagamento). */
  valorCentavos: number | null;
  /** Só dinheiro: valor entregue pelo cliente (calcula o troco). */
  valorRecebidoCentavos?: number | null;
  autorizacao?: string | null;
  parcelas?: number;
  /** UUID gerado pela tela: evita pagamento duplicado. */
  chaveIdempotencia: string;
}

export interface PedidoSaida {
  /** O valor que o operador viu. Se mudou (passou de uma fração), a saída é recusada para conferência. */
  valorEsperadoCentavos: number;
  pagamentos: PagamentoSaida[];
  descontoCentavos?: number;
  acrescimoCentavos?: number;
  motivoAjuste?: string | null;
  postoId?: string | null;
}

export interface ReciboSaida {
  sessao: SessaoDetalhe;
  trocoTotalCentavos: number;
}

export interface CaixaAtual {
  id: string;
  posto: string;
  postoId: string;
  abertoEm: string;
  saldoInicialCentavos: number;
  /** Dinheiro que deveria estar na gaveta (abertura + recebimentos − estornos − sangrias). */
  dinheiroEsperadoCentavos: number;
  recebidoPorForma: { forma: string; nome: string; centavos: number }[];
}

export interface Posto {
  id: string;
  nome: string;
}

export interface VagaLivre {
  id: string;
  codigo: string;
  setor: string | null;
}

/** Pedido de prévia: o mesmo da saída, sem chave de idempotência e sem gravar nada. */
export interface PedidoPreviaSaida {
  descontoCentavos?: number;
  acrescimoCentavos?: number;
  pagamentos: Omit<PagamentoSaida, 'chaveIdempotencia'>[];
}

/** Tudo o que a tela de saída mostra, calculado pelo servidor. */
export interface PreviaSaida {
  calculo: CalculoEstadia;
  descontoCentavos: number;
  acrescimoCentavos: number;
  valorFinalCentavos: number;
  /** Valor final − já pago. */
  aPagarCentavos: number;
  pagamentos: {
    linha: number;
    forma: string;
    formaNome: string;
    valorCentavos: number;
    valorRecebidoCentavos: number | null;
    trocoCentavos: number;
    automatico: boolean;
  }[];
  somaPagamentosCentavos: number;
  /** a pagar − soma: positivo = falta, negativo = sobra. */
  diferencaCentavos: number;
  trocoTotalCentavos: number;
  /** Vazio = pode confirmar a saída com este pedido. */
  problemas: { mensagem: string; linha?: number; acao?: 'ABRIR_CAIXA' }[];
}
