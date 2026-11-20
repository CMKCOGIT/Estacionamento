import type { PoliticaAcessoCliente } from '@estacionamento/shared';
import { api } from './api';

export const configuracoesApi = {
  acessoCliente: () => api<PoliticaAcessoCliente>('/configuracoes/acesso-cliente'),
  salvarAcessoCliente: (p: PoliticaAcessoCliente) =>
    api<PoliticaAcessoCliente>('/configuracoes/acesso-cliente', { method: 'PUT', corpo: p }),
};
