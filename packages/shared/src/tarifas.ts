/** Contratos do gerenciamento de tarifas (painel ↔ servidor local). */
import type { CondicaoEspecial, RegraTarifa } from './tarifa.js';

export type TipoRegra = 'PADRAO' | 'ESPECIAL';
export type AplicacaoEspecial = 'AUTOMATICA' | 'MANUAL';
export type StatusTabela = 'RASCUNHO' | 'PUBLICADA' | 'ARQUIVADA';
/** Situação calculada: PUBLICADA vira VIGENTE, AGENDADA (início futuro) ou SUBSTITUIDA. */
export type SituacaoTabela = 'RASCUNHO' | 'VIGENTE' | 'AGENDADA' | 'SUBSTITUIDA' | 'ARQUIVADA';

/** Campos editáveis de uma regra (padrão de uma categoria ou tarifa especial). */
export interface DadosRegra extends CondicaoEspecial {
  categoriaId: string;
  tipo: TipoRegra;
  /** Obrigatório nas especiais (ex.: "Fim de semana", "Convênio Farmácia"). */
  nome: string | null;
  /** AUTOMATICA: vale sozinha no dia/horário; MANUAL: o operador escolhe na entrada. */
  aplicacao: AplicacaoEspecial | null;
  ativo: boolean;
  toleranciaMin: number;
  primeiraHoraCentavos: number;
  horaAdicionalCentavos: number;
  fracaoMin: number | null;
  fracaoCentavos: number | null;
  carenciaMin: number;
  diariaMaximaCentavos: number | null;
  diariaCentavos: number | null;
  valorFixoCentavos: number | null;
}

export interface RegraCadastrada extends DadosRegra {
  id: string;
  categoria: string;
  ordem: number;
}

export interface TabelaTarifaResumo {
  id: string;
  versao: number;
  nome: string;
  descricao: string | null;
  status: StatusTabela;
  situacao: SituacaoTabela;
  vigenteDesde: string | null;
  publicadoEm: string | null;
  publicadoPor: string | null;
  criadoPor: string | null;
  criadoEm: string;
  arquivadoEm: string | null;
  /** Quantos tickets foram cobrados por esta versão (não pode ser alterada por isso). */
  ticketsUsaram: number;
}

export interface TabelaTarifaDetalhe extends TabelaTarifaResumo {
  regras: RegraCadastrada[];
}

export interface PainelTarifas {
  vigente: TabelaTarifaDetalhe | null;
  rascunho: TabelaTarifaDetalhe | null;
  agendadas: TabelaTarifaResumo[];
  historico: TabelaTarifaResumo[];
}

export interface PedidoPublicacao {
  /** null = agora. Data futura = agenda a troca de preços. */
  vigenteDesde: string | null;
}

/** Opção de tarifa mostrada na entrada. */
export interface OpcaoTarifaEntrada {
  id: string;
  tipo: TipoRegra;
  nome: string;
  aplicacao: AplicacaoEspecial | null;
  descricao: string;
  condicao: string | null;
  temDiaria: boolean;
}

export interface TarifasDaEntrada {
  tabela: { id: string; versao: number; nome: string } | null;
  opcoes: OpcaoTarifaEntrada[];
  /** Regra que será usada se o operador não escolher (padrão ou especial automática do horário). */
  automaticaId: string | null;
}

/** O que fica gravado no ticket na entrada (rastreabilidade financeira). */
export interface TarifaAplicada {
  tabelaId: string;
  tabelaVersao: number;
  tabelaNome: string;
  vigenteDesde: string;
  regraId: string;
  tipo: TipoRegra;
  nome: string;
  categoria: string;
  /** Como a regra foi escolhida. */
  selecao: 'PADRAO' | 'ESPECIAL_AUTOMATICA' | 'ESPECIAL_MANUAL';
  regra: Required<RegraTarifa>;
}

export function regraDeDados(d: Pick<DadosRegra, keyof RegraTarifa>): Required<RegraTarifa> {
  return {
    toleranciaMin: d.toleranciaMin,
    primeiraHoraCentavos: d.primeiraHoraCentavos,
    horaAdicionalCentavos: d.horaAdicionalCentavos,
    fracaoMin: d.fracaoMin,
    fracaoCentavos: d.fracaoCentavos,
    diariaMaximaCentavos: d.diariaMaximaCentavos,
    diariaCentavos: d.diariaCentavos,
    carenciaMin: d.carenciaMin,
    valorFixoCentavos: d.valorFixoCentavos,
  };
}
