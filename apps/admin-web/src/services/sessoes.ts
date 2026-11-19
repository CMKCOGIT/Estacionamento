import type {
  AcessoCliente,
  CaixaAtual,
  FormaPagamento,
  Lista,
  PedidoEntrada,
  PedidoPreviaSaida,
  PedidoSaida,
  PreviaSaida,
  ReciboSaida,
  ResultadoEntrada,
  SessaoDetalhe,
  VagaLivre,
} from '@estacionamento/shared';
import { api } from './api';

export const sessoesApi = {
  abertas: () => api<Lista<SessaoDetalhe>>('/sessoes/abertas'),
  obter: (id: string) => api<SessaoDetalhe>(`/sessoes/${id}`),
  localizar: (termo: string) => api<SessaoDetalhe>(`/sessoes/localizar?termo=${encodeURIComponent(termo)}`),
  vagasLivres: (categoriaId: string) =>
    api<Lista<VagaLivre>>(`/sessoes/vagas-livres?categoriaId=${categoriaId}`),
  entrada: (p: PedidoEntrada) => api<ResultadoEntrada>('/sessoes/entrada', { method: 'POST', corpo: p }),
  /** Valor agora, pagamentos conferidos e troco — calculados pelo servidor, sem gravar. */
  previaSaida: (id: string, p: PedidoPreviaSaida) =>
    api<PreviaSaida>(`/sessoes/${id}/previa-saida`, { method: 'POST', corpo: p }),
  saida: (id: string, p: PedidoSaida) =>
    api<ReciboSaida>(`/sessoes/${id}/saida`, { method: 'POST', corpo: p }),
  cancelar: (id: string, motivo: string) =>
    api<SessaoDetalhe>(`/sessoes/${id}/cancelar`, { method: 'POST', corpo: { motivo } }),
  novoLink: (id: string) => api<AcessoCliente>(`/sessoes/${id}/novo-link`, { method: 'POST' }),
};

export const caixaApi = {
  atual: () => api<{ caixa: CaixaAtual | null }>('/caixa/atual'),
  formas: () => api<Lista<FormaPagamento>>('/caixa/formas'),
  abrir: (saldoInicialCentavos: number) =>
    api<CaixaAtual>('/caixa/abrir', { method: 'POST', corpo: { saldoInicialCentavos } }),
  fechar: (saldoContadoCentavos: number, observacao: string | null) =>
    api<{ esperadoCentavos: number; contadoCentavos: number; diferencaCentavos: number }>('/caixa/fechar', {
      method: 'POST',
      corpo: { saldoContadoCentavos, observacao },
    }),
};
