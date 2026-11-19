import type {
  AlterarCapacidade,
  Categoria,
  DadosVaga,
  Lista,
  ListaVagas,
  NovasVagasLote,
  ResultadoCapacidade,
  ResultadoRemocao,
  VagaDetalhe,
} from '@estacionamento/shared';
import { api } from './api';

export const vagasApi = {
  listar: (f: { categoriaId?: string; estado?: string; busca?: string; incluirRemovidas?: boolean }) => {
    const q = new URLSearchParams();
    if (f.categoriaId) q.set('categoriaId', f.categoriaId);
    if (f.estado) q.set('estado', f.estado);
    if (f.busca) q.set('busca', f.busca);
    if (f.incluirRemovidas) q.set('incluirRemovidas', 'true');
    return api<ListaVagas>(`/vagas${q.size ? `?${q}` : ''}`);
  },
  obter: (id: string) => api<VagaDetalhe>(`/vagas/${id}`),
  criar: (d: DadosVaga) => api<VagaDetalhe>('/vagas', { method: 'POST', corpo: d }),
  criarLote: (d: NovasVagasLote) =>
    api<{ criadas: string[]; capacidade: number }>('/vagas/lote', { method: 'POST', corpo: d }),
  editar: (id: string, d: DadosVaga) => api<VagaDetalhe>(`/vagas/${id}`, { method: 'PATCH', corpo: d }),
  bloquear: (id: string, motivo: string) =>
    api<VagaDetalhe>(`/vagas/${id}/bloquear`, { method: 'POST', corpo: { motivo } }),
  liberar: (id: string) => api<VagaDetalhe>(`/vagas/${id}/liberar`, { method: 'POST' }),
  remover: (id: string, motivo: string) =>
    api<ResultadoRemocao>(`/vagas/${id}/remover`, { method: 'POST', corpo: { motivo } }),
  reativar: (id: string) => api<VagaDetalhe>(`/vagas/${id}/reativar`, { method: 'POST' }),
  capacidade: (d: AlterarCapacidade) =>
    api<ResultadoCapacidade>('/vagas/capacidade', { method: 'PUT', corpo: d }),
  categorias: () => api<Lista<Categoria>>('/categorias'),
  criarCategoria: (codigo: string, nome: string) =>
    api<Lista<Categoria>>('/categorias', { method: 'POST', corpo: { codigo, nome } }),
  editarCategoria: (id: string, nome: string, ativo: boolean) =>
    api<Lista<Categoria>>(`/categorias/${id}`, { method: 'PATCH', corpo: { nome, ativo } }),
};
