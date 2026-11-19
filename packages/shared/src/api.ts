/**
 * Contrato de erro da API — mesmo formato no servidor local e na nuvem.
 * O frontend usa `codigo` para decidir o que fazer e `mensagem` para exibir.
 */
export const CODIGOS_ERRO = [
  'REQUISICAO_INVALIDA',
  'JSON_INVALIDO',
  'CORPO_MUITO_GRANDE',
  'NAO_AUTENTICADO',
  'SESSAO_EXPIRADA',
  'CREDENCIAIS_INVALIDAS',
  'CONTA_BLOQUEADA',
  'MUITAS_TENTATIVAS',
  'TROCA_SENHA_OBRIGATORIA',
  'SEM_PERMISSAO',
  'ORIGEM_NAO_PERMITIDA',
  'NAO_ENCONTRADO',
  'ROTA_NAO_ENCONTRADA',
  'CONFLITO',
  'REGISTRO_DUPLICADO',
  'REGISTRO_EM_USO',
  'REGRA_DE_NEGOCIO',
  'DADOS_INVALIDOS',
  'BANCO_INDISPONIVEL',
  'SISTEMA_NAO_CONFIGURADO',
  'ERRO_INTERNO',
] as const;

export type CodigoErro = (typeof CODIGOS_ERRO)[number];

export interface DetalheValidacao {
  campo: string;
  mensagem: string;
}

export interface ErroApi {
  erro: {
    codigo: CodigoErro;
    mensagem: string;
    detalhes?: DetalheValidacao[] | Record<string, unknown>;
    requestId?: string;
  };
}

/** Resposta padrão de listas. */
export interface Lista<T> {
  itens: T[];
}

export interface StatusSistema {
  status: 'ok' | 'degradado';
  servico: string;
  versao: string;
  ambiente: string;
  iniciadoEm: string;
  uptimeSegundos: number;
  banco: {
    ok: boolean;
    versao?: string;
    nome?: string;
    latenciaMs?: number;
    erro?: string;
  };
}

export interface FormaPagamento {
  codigo: string;
  nome: string;
  permiteTroco: boolean;
  exigeAutorizacao: boolean;
  permiteParcelas: boolean;
  ativo: boolean;
  ordem: number;
}
