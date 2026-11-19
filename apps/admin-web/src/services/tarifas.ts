import type {
  DadosRegra,
  PainelTarifas,
  PedidoSimulacao,
  ResultadoSimulacao,
  TabelaTarifaDetalhe,
  TarifasDaEntrada,
} from '@estacionamento/shared';
import { api } from './api';

export const tarifasApi = {
  painel: () => api<PainelTarifas>('/tarifas'),
  obter: (id: string) => api<TabelaTarifaDetalhe>(`/tarifas/${id}`),
  novaVersao: (d: { baseId?: string | null; nome?: string | null } = {}) =>
    api<TabelaTarifaDetalhe>('/tarifas', { method: 'POST', corpo: d }),
  renomear: (id: string, d: { nome: string; descricao: string | null }) =>
    api<TabelaTarifaDetalhe>(`/tarifas/${id}`, { method: 'PATCH', corpo: d }),
  descartar: (id: string) => api<void>(`/tarifas/${id}`, { method: 'DELETE' }),
  salvarRegra: (tabelaId: string, regraId: string | null, d: DadosRegra) =>
    regraId
      ? api<TabelaTarifaDetalhe>(`/tarifas/${tabelaId}/regras/${regraId}`, { method: 'PUT', corpo: d })
      : api<TabelaTarifaDetalhe>(`/tarifas/${tabelaId}/regras`, { method: 'POST', corpo: d }),
  removerRegra: (tabelaId: string, regraId: string) =>
    api<TabelaTarifaDetalhe>(`/tarifas/${tabelaId}/regras/${regraId}`, { method: 'DELETE' }),
  publicar: (id: string, vigenteDesde: string | null) =>
    api<TabelaTarifaDetalhe>(`/tarifas/${id}/publicar`, { method: 'POST', corpo: { vigenteDesde } }),
  arquivar: (id: string) =>
    api<TabelaTarifaDetalhe>(`/tarifas/${id}/arquivar`, { method: 'POST', corpo: {} }),
  /** Quanto custa ficar X minutos: calculado pelo servidor. */
  simular: (p: PedidoSimulacao) => api<ResultadoSimulacao>('/tarifas/simular', { method: 'POST', corpo: p }),
  daEntrada: (categoriaId: string) => api<TarifasDaEntrada>(`/sessoes/tarifas?categoriaId=${categoriaId}`),
};
