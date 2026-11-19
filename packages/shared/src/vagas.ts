/** Contratos do módulo de vagas. */

/** Estado visível no mapa: verde (LIVRE), vermelho (OCUPADA), cinza (BLOQUEADA). */
export type EstadoVaga = 'LIVRE' | 'OCUPADA' | 'BLOQUEADA' | 'REMOVIDA';

export interface Categoria {
  id: string;
  codigo: string;
  nome: string;
  ativo: boolean;
  ordem: number;
  /** Capacidade = vagas livres + ocupadas + bloqueadas (removidas não contam). */
  capacidade: number;
}

export interface OcupacaoAtual {
  sessaoId: string;
  numero: string;
  placa: string;
  entradaEm: string;
  permanenciaMin: number;
}

export interface Vaga {
  id: string;
  codigo: string;
  setor: string | null;
  categoriaId: string;
  categoria: string;
  estado: EstadoVaga;
  coberta: boolean;
  observacao: string | null;
  bloqueio: { motivo: string; em: string; por: string | null } | null;
  ocupacao: OcupacaoAtual | null;
  /** Já recebeu algum veículo: ao "excluir", é desativada (histórico preservado). */
  temHistorico: boolean;
}

export interface ResumoVagas {
  total: number;
  livres: number;
  ocupadas: number;
  bloqueadas: number;
  removidas: number;
}

export interface ListaVagas {
  itens: Vaga[];
  resumo: ResumoVagas;
  setores: string[];
  atualizadoEm: string;
}

export interface UsoVaga {
  sessaoId: string;
  numero: string;
  placa: string;
  entradaEm: string;
  saidaEm: string | null;
  status: string;
}

export interface VagaDetalhe extends Vaga {
  ultimosUsos: UsoVaga[];
  criadaEm: string;
  desativadaEm: string | null;
}

export interface DadosVaga {
  codigo: string;
  setor?: string | null;
  categoriaId: string;
  coberta?: boolean;
  observacao?: string | null;
}

/** Cadastro em lote: prefixo + numeração (ex.: A-01 … A-20). */
export interface NovasVagasLote {
  prefixo: string;
  inicio: number;
  quantidade: number;
  digitos: number;
  setor?: string | null;
  categoriaId: string;
  coberta?: boolean;
}

export interface AlterarCapacidade {
  categoriaId: string;
  capacidade: number;
  /** Para criar vagas novas, se faltar. */
  prefixo?: string;
  setor?: string | null;
  motivo: string;
}

export interface ResultadoCapacidade {
  categoria: string;
  anterior: number;
  nova: number;
  criadas: string[];
  reativadas: string[];
  excluidas: string[];
  desativadas: string[];
}

export interface ResultadoRemocao {
  /** EXCLUIDA = nunca foi usada, apagada; DESATIVADA = tem histórico, mantida como removida. */
  resultado: 'EXCLUIDA' | 'DESATIVADA';
  codigo: string;
}

/** Normaliza o código da vaga: maiúsculas, sem espaços (ex.: " a-01 " → "A-01"). */
export function normalizarCodigoVaga(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/\s+/g, '');
}

export const PADRAO_CODIGO_VAGA = /^[A-Z0-9][A-Z0-9-]{0,19}$/;

/** Gera os códigos de um lote: prefixo "A-", início 1, 3 vagas, 2 dígitos → A-01, A-02, A-03. */
export function gerarCodigosVaga(
  prefixo: string,
  inicio: number,
  quantidade: number,
  digitos: number,
): string[] {
  const p = normalizarCodigoVaga(prefixo);
  return Array.from({ length: quantidade }, (_, i) => `${p}${String(inicio + i).padStart(digitos, '0')}`);
}

/** Ordenação natural: A-2 antes de A-10. */
export function compararCodigos(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });
}
