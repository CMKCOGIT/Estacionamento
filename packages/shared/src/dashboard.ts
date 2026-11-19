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
