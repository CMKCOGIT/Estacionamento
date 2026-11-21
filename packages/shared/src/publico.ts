/**
 * Contrato da API PÚBLICA (servidor externo, `/v1`), consumida pelo PWA do
 * cliente. Só leitura e só o que o cliente pode ver: nada de usuários,
 * operadores, caixa ou tickets de outras pessoas.
 */
import type { ItemCalculo } from './tarifa.js';

export interface EstacionamentoPublico {
  slug: string;
  nome: string;
  endereco: string | null;
  telefone: string | null;
  /** Quando o servidor local enviou estes dados pela última vez. */
  sincronizadoEm: string | null;
}

export interface DisponibilidadePublica {
  estacionamento: EstacionamentoPublico;
  totalVagas: number;
  vagasLivres: number;
  categorias: { categoria: string; total: number; livres: number }[];
  atualizadoEm: string | null;
}

export interface TarifaPublica {
  categoria: string;
  /** "Padrão" ou o nome da especial (ex.: "Fim de semana"). */
  nome: string;
  especial: boolean;
  /** Quando vale (especiais automáticas), ex.: "Sáb e Dom". */
  condicao: string | null;
  /** Linhas legíveis: "1ª hora R$ 10,00", "Tolerância de 10 min"... */
  linhas: string[];
}

export interface TarifasPublicas {
  estacionamento: EstacionamentoPublico;
  vigenteDesde: string | null;
  tarifas: TarifaPublica[];
}

export type SituacaoTicketPublico = 'ESTACIONADO' | 'ENCERRADO' | 'CANCELADO';

/** O ticket do próprio cliente (identificado só pelo token do link). */
export interface TicketPublico {
  estacionamento: EstacionamentoPublico;
  numero: string;
  placa: string;
  categoria: string;
  vaga: string | null;
  situacao: SituacaoTicketPublico;
  entradaEm: string;
  saidaEm: string | null;
  permanenciaMin: number;
  /** Valor acumulado agora (estacionado) ou valor final (encerrado). */
  valorCentavos: number;
  pagoCentavos: number;
  aPagarCentavos: number;
  /** Tarifa gravada na entrada, em texto. */
  tarifa: string;
  /**
   * Tabela de preços DESTE ticket: a regra gravada na entrada (uma mudança
   * de preço depois da entrada não altera este ticket).
   */
  tabelaTarifa: { nome: string; categoria: string; linhas: string[] };
  itens: ItemCalculo[];
  /** Estacionado: quando o valor sobe e para quanto. */
  proximaCobranca: { em: string; valorCentavos: number } | null;
  /** Instante do cálculo (relógio do servidor) = última atualização da consulta. */
  calculadoEm: string;
  /** Última vez que o servidor local atualizou este ticket na nuvem. */
  sincronizadoEm: string;
  /** Quando o link deixa de funcionar (definido na saída, pela política). */
  acessoExpiraEm: string | null;
  /** Política de encerramento do estacionamento (para explicar ao cliente). */
  politicaAcesso: { horasAposSaida: number };
}

/** Resposta de erro da API pública (sem detalhes internos). */
export interface ErroPublico {
  erro: {
    codigo:
      | 'NAO_ENCONTRADO'
      | 'MUITAS_TENTATIVAS'
      | 'REQUISICAO_INVALIDA'
      | 'NAO_AUTORIZADO'
      | 'PROIBIDO'
      | 'CONFLITO'
      | 'INDISPONIVEL';
    mensagem: string;
  };
}

/** Formato do token no link (32 bytes em base64url = 43 caracteres). */
export const PADRAO_TOKEN_TICKET = /^[A-Za-z0-9_-]{43}$/;
