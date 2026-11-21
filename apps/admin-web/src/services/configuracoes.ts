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
}

export const syncApi = {
  status: () => api<StatusSync>('/sync/status'),
  ressincronizar: () => api<StatusSync>('/sync/ressincronizar', { method: 'POST', corpo: {} }),
};
