/** Contrato do Dashboard (GET /api/v1/dashboard). Seções nulas = sem permissão. */

export interface OcupacaoCategoria {
  categoriaId: string;
  codigo: string;
  nome: string;
  total: number;
  disponiveis: number;
  ocupadas: number;
  bloqueadas: number;
}

export interface MovimentoHora {
  hora: number;
  entradas: number;
  saidas: number;
  /** Por código da categoria (ex.: CARRO, MOTO). */
  categorias: Record<string, { entradas: number; saidas: number }>;
}

export interface PontoOcupacao {
  /** Instante (ISO) do ponto. */
  em: string;
  ocupadas: number;
}

export interface FaturamentoDia {
  /** Data local AAAA-MM-DD. */
  data: string;
  totalCentavos: number;
  porForma: Record<string, number>;
}

export type TipoMovimento = 'ENTRADA' | 'SAIDA' | 'CANCELAMENTO';

export interface Movimento {
  tipo: TipoMovimento;
  em: string;
  sessaoId: string;
  numero: string;
  placa: string;
  vaga: string | null;
  categoria: string;
  operador: string | null;
  /** Valor final (saída) ou permanência em minutos (saída). */
  valorCentavos: number | null;
  permanenciaMin: number | null;
}

export type NivelAlerta = 'critico' | 'serio' | 'atencao' | 'info';

export interface Alerta {
  codigo: string;
  nivel: NivelAlerta;
  titulo: string;
  detalhe: string;
}

export type SituacaoSync = 'NAO_CONFIGURADA' | 'NUNCA_SINCRONIZOU' | 'EM_DIA' | 'ATRASADA' | 'COM_ERROS';

export interface DashboardResposta {
  geradoEm: string;
  operacao: {
    vagas: { total: number; disponiveis: number; ocupadas: number; bloqueadas: number };
    porCategoria: OcupacaoCategoria[];
    veiculosEstacionados: number;
    /** Ocupação hora a hora nas últimas 24h (25 pontos, o último é "agora"). */
    ocupacao24h: PontoOcupacao[];
    hoje: {
      entradas: number;
      saidas: number;
      cancelamentos: number;
      permanenciaMediaMin: number | null;
    };
    /** Entradas e saídas de hoje por hora (0–23, fuso do estacionamento), também por categoria. */
    movimentoPorHora: MovimentoHora[];
    ultimosMovimentos: Movimento[];
  } | null;
  financeiro: {
    faturamentoHojeCentavos: number;
    faturamentoOntemCentavos: number;
    hojePorForma: { forma: string; nome: string; centavos: number; quantidade: number }[];
    estornosHoje: { quantidade: number; centavos: number };
    /** Sessões abertas com valor estimado ainda não pago. */
    pendentes: { quantidade: number; valorEstimadoCentavos: number; parcialmentePagas: number };
    faturamento7dias: FaturamentoDia[];
    caixasAbertos: { id: string; operador: string; posto: string; abertoEm: string }[];
    /**
     * Caixa hoje. "Recebido no caixa" são os pagamentos presenciais do dia
     * (todas as formas); "dinheiro em caixa" é o que deve estar nas gavetas
     * abertas agora (saldo inicial + dinheiro recebido − troco − sangrias...).
     */
    caixa: {
      abertos: number;
      fechadosHoje: number;
      saldoInicialCentavos: number;
      dinheiroEmCaixaCentavos: number;
      recebidoNoCaixaCentavos: number;
      recebimentos: number;
    };
  } | null;
  sincronizacao: {
    situacao: SituacaoSync;
    pendentes: number;
    rejeitados: number;
    ultimoSucessoEm: string | null;
    pendenteMaisAntigoEm: string | null;
    ultimoErro: string | null;
  } | null;
  alertas: Alerta[];
}
