import type {
  ConfiguracoesGerais,
  PoliticaAcessoCliente,
  PreferenciasOperacao,
  SessaoLoginAtiva,
} from '@estacionamento/shared';
import { api } from './api';

export const configuracoesApi = {
  acessoCliente: () => api<PoliticaAcessoCliente>('/configuracoes/acesso-cliente'),
  salvarAcessoCliente: (p: PoliticaAcessoCliente) =>
    api<PoliticaAcessoCliente>('/configuracoes/acesso-cliente', { method: 'PUT', corpo: p }),
};

export interface StatusSync {
  configurado: boolean;
  nuvem: string | null;
  situacao: 'DESLIGADA' | 'EM_DIA' | 'ENVIANDO' | 'COM_FALHA' | 'AGUARDANDO_PRIMEIRO_ENVIO';
  pendentes: number;
  pendenteMaisAntigoEm: string | null;
  rejeitados: { seq: number; tipo: string; erro: string | null; em: string | null }[];
  ultimoSucessoEm: string | null;
  ultimoContatoEm: string | null;
  ultimoSnapshotEm: string | null;
  snapshotPendente: boolean;
  falhasSeguidas: number;
  ultimoErro: string | null;
  ultimoErroEm: string | null;
  marcasPendentes: number;
  ultimaConferenciaEm: string | null;
  ultimaConferenciaDivergencias: number | null;
  conferenciaPendente: boolean;
  resumo: { origem: string; resultado: string; total: number }[];
  historico: {
    id: number;
    tipo: string;
    iniciadoEm: string | null;
    sucesso: boolean;
    itens: number;
    duracaoMs: number | null;
    httpStatus: number | null;
    erro: string | null;
    requisicaoId: string | null;
    detalhes: Record<string, unknown> | null;
  }[];
}

export const syncApi = {
  status: () => api<StatusSync>('/sync/status'),
  ressincronizar: () => api<StatusSync>('/sync/ressincronizar', { method: 'POST', corpo: {} }),
  conferir: () => api<StatusSync>('/sync/conferir', { method: 'POST', corpo: {} }),
};

// ---------------------------------------------------------------------------
// Configurações por categoria
// ---------------------------------------------------------------------------
export type CategoriaEditavel =
  'estacionamento' | 'operacao' | 'notificacoes' | 'seguranca' | 'limitesAjuste' | 'backup';

export interface DadosDoPainel {
  nome: string;
  logo: string | null;
  operacao: PreferenciasOperacao;
}

export const configGeralApi = {
  obter: () => api<ConfiguracoesGerais>('/configuracoes'),
  painel: () => api<DadosDoPainel>('/configuracoes/painel'),
  salvar: (categoria: CategoriaEditavel, valor: unknown) =>
    api<ConfiguracoesGerais>(`/configuracoes/${categoria}`, { method: 'PUT', corpo: valor }),
  sessoes: () => api<{ itens: SessaoLoginAtiva[] }>('/configuracoes/seguranca/sessoes'),
  encerrarSessao: (id: string) =>
    api<void>(`/configuracoes/seguranca/sessoes/${id}/encerrar`, { method: 'POST', corpo: {} }),
  salvarPadrao: (codigo: 'padrao_gerente' | 'padrao_operador', permissoes: string[]) =>
    api<void>(`/permissoes/modelos/${codigo}`, { method: 'PUT', corpo: { permissoes } }),
};

export interface RegistroNaoSincronizado {
  seq: string;
  eventoId: string;
  tipo: string;
  entidade: string;
  status: 'PENDENTE' | 'REJEITADO';
  tentativas: number;
  proximaTentativaEm: string | null;
  ultimoErro: string | null;
  criadoEm: string;
}

export const syncFilaApi = {
  pendentes: () => api<{ itens: RegistroNaoSincronizado[] }>('/sync/pendentes'),
  reenviar: () =>
    api<{ pendentes: number; recolocados: number }>('/sync/reenviar', { method: 'POST', corpo: {} }),
};
