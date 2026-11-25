/**
 * LGPD (Lei 13.709/2018): tipos do atendimento aos titulares e da retenção.
 * Ver docs/LGPD.md.
 */
export type TipoSolicitacaoLgpd =
  | 'CONFIRMACAO_ACESSO'
  | 'CORRECAO'
  | 'ANONIMIZACAO_ELIMINACAO'
  | 'PORTABILIDADE'
  | 'INFORMACAO_COMPARTILHAMENTO'
  | 'REVOGACAO_CONSENTIMENTO'
  | 'OPOSICAO';

export const TIPOS_SOLICITACAO_LGPD: Record<TipoSolicitacaoLgpd, string> = {
  CONFIRMACAO_ACESSO: 'Confirmação e acesso aos dados (art. 18, I e II)',
  CORRECAO: 'Correção de dados (art. 18, III)',
  ANONIMIZACAO_ELIMINACAO: 'Anonimização ou eliminação (art. 18, IV e VI)',
  PORTABILIDADE: 'Portabilidade (art. 18, V)',
  INFORMACAO_COMPARTILHAMENTO: 'Com quem os dados são compartilhados (art. 18, VII)',
  REVOGACAO_CONSENTIMENTO: 'Revogação de consentimento (art. 18, IX)',
  OPOSICAO: 'Oposição ao tratamento (art. 18, § 2º)',
};

export type StatusSolicitacaoLgpd = 'ABERTA' | 'EM_ANDAMENTO' | 'ATENDIDA' | 'INDEFERIDA';

/** Prazo para a resposta completa (art. 19, II). */
export const PRAZO_SOLICITACAO_DIAS = 15;

export interface SolicitacaoLgpd {
  id: string;
  protocolo: string;
  tipo: TipoSolicitacaoLgpd;
  titularNome: string | null;
  titularContato: string | null;
  /** Placa informada (some depois da conclusão + prazo de guarda). */
  identificador: string | null;
  descricao: string | null;
  status: StatusSolicitacaoLgpd;
  recebidaEm: string;
  prazoEm: string;
  vencida: boolean;
  concluidaEm: string | null;
  resposta: string | null;
}

export interface NovaSolicitacaoLgpd {
  tipo: TipoSolicitacaoLgpd;
  titularNome?: string | null;
  titularContato?: string | null;
  placa?: string | null;
  descricao?: string | null;
}

/** Política de retenção (Configurações → Privacidade). */
export interface PoliticaRetencao {
  /** Placas de veículos sem visita há mais que isso são anonimizadas (padrão: 5 anos). */
  placasMeses: number;
  /** Sessões de login do painel (IP e navegador) encerradas há mais que isso são apagadas. */
  acessosPainelDias: number;
  /** Histórico de atividades (auditoria) além disso é apagado. */
  historicoMeses: number;
  /** Solicitações concluídas: a identificação do titular é apagada depois disso. */
  solicitacoesMeses: number;
}

export const POLITICA_RETENCAO_PADRAO: PoliticaRetencao = {
  placasMeses: 60,
  acessosPainelDias: 180,
  historicoMeses: 60,
  solicitacoesMeses: 6,
};

export interface ResultadoRetencao {
  executadaEm: string;
  veiculosAnonimizados: number;
  acessosApagados: number;
  historicoApagado: number;
  solicitacoesRedigidas: number;
}

/** Encarregado pelo tratamento de dados (art. 41): divulgado no app do cliente. */
export interface EncarregadoDados {
  nome: string | null;
  contato: string | null;
}

/** Relatório do titular (acesso e portabilidade): só os dados DELE. */
export interface RelatorioTitular {
  geradoEm: string;
  identificador: { tipo: 'PLACA'; valor: string };
  controlador: { nome: string; documento: string | null; encarregado: EncarregadoDados };
  veiculo: {
    placa: string;
    categoria: string;
    marca: string | null;
    modelo: string | null;
    cor: string | null;
    cadastradoEm: string;
    primeiraVisitaEm: string | null;
    ultimaVisitaEm: string | null;
  } | null;
  clientesVinculados: {
    nome: string;
    documento: string | null;
    telefone: string | null;
    email: string | null;
  }[];
  estadias: {
    numero: string;
    situacao: string;
    entradaEm: string;
    saidaEm: string | null;
    valorFinalCentavos: number | null;
    pagoCentavos: number;
    formasPagamento: string[];
  }[];
  compartilhamento: { destinatario: string; finalidade: string; dados: string; ate: string | null }[];
  finalidades: { finalidade: string; baseLegal: string }[];
  retencao: { anonimizacaoPrevistaEm: string | null; observacao: string };
  emAndamento: boolean;
}

export interface ResultadoAnonimizacao {
  pseudonimo: string;
  estadias: number;
  registrosDeHistorico: number;
  clientesAnonimizados: number;
  removidosDaNuvem: number;
}

// ---------------------------------------------------------------------------
// Incidentes de segurança (art. 48) e inventário de dados pessoais
// ---------------------------------------------------------------------------
export type GravidadeIncidente = 'BAIXA' | 'MEDIA' | 'ALTA';

export interface IncidenteSeguranca {
  id: string;
  ocorridoEm: string | null;
  detectadoEm: string;
  descricao: string;
  dadosAfetados: string;
  titularesAfetados: number | null;
  gravidade: GravidadeIncidente;
  medidas: string | null;
  comunicadoAnpdEm: string | null;
  comunicadoTitularesEm: string | null;
  status: 'ABERTO' | 'ENCERRADO';
  registradoPor: string | null;
  registradoEm: string;
  encerradoEm: string | null;
}

export interface NovoIncidente {
  ocorridoEm?: string | null;
  detectadoEm: string;
  descricao: string;
  dadosAfetados: string;
  titularesAfetados?: number | null;
  gravidade: GravidadeIncidente;
  medidas?: string | null;
}

export interface AtualizacaoIncidente {
  gravidade?: GravidadeIncidente;
  medidas?: string | null;
  titularesAfetados?: number | null;
  comunicadoAnpd?: boolean;
  comunicadoTitulares?: boolean;
  encerrar?: boolean;
}

/** Uma categoria de dado pessoal guardado, com a quantidade real no banco. */
export interface ItemInventario {
  categoria: string;
  dados: string;
  finalidade: string;
  quemAcessa: string;
  retencao: string;
  quantidade: number;
}
export interface InventarioDados {
  geradoEm: string;
  itens: ItemInventario[];
  /** Endereço da política de privacidade publicada no app do cliente. */
  politicaUrl: string | null;
}
