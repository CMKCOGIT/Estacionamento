import type { PoliticaAcessoCliente } from '@estacionamento/shared';
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
