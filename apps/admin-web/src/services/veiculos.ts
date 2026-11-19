import type {
  ConsultaPlaca,
  DadosVeiculo,
  ListaVeiculos,
  PaginaEstadias,
  VeiculoDetalhe,
} from '@estacionamento/shared';
import { api } from './api';

export const veiculosApi = {
  listar: (f: { busca?: string; categoriaId?: string; estacionados?: boolean; pagina?: number }) => {
    const q = new URLSearchParams();
    if (f.busca) q.set('busca', f.busca);
    if (f.categoriaId) q.set('categoriaId', f.categoriaId);
    if (f.estacionados) q.set('estacionados', 'true');
    if (f.pagina && f.pagina > 1) q.set('pagina', String(f.pagina));
    return api<ListaVeiculos>(`/veiculos${q.size ? `?${q}` : ''}`);
  },
  consultarPlaca: (placa: string) => api<ConsultaPlaca>(`/veiculos/placa/${encodeURIComponent(placa)}`),
  obter: (id: string) => api<VeiculoDetalhe>(`/veiculos/${id}`),
  estadias: (id: string, pagina = 1) =>
    api<PaginaEstadias>(`/veiculos/${id}/estadias?pagina=${pagina}&limite=20`),
  criar: (d: DadosVeiculo) => api<VeiculoDetalhe>('/veiculos', { method: 'POST', corpo: d }),
  editar: (id: string, d: DadosVeiculo & { motivo?: string }) =>
    api<VeiculoDetalhe>(`/veiculos/${id}`, { method: 'PATCH', corpo: d }),
  remover: (id: string, motivo: string) =>
    api<{ placa: string }>(`/veiculos/${id}/remover`, { method: 'POST', corpo: { motivo } }),
};
