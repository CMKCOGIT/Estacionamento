import type {
  CatalogoPermissoes,
  DadosAcesso,
  DadosFuncionario,
  FuncionarioDetalhe,
  FuncionarioResumo,
  Lista,
  NovoFuncionario,
  PaginaAtividades,
} from '@estacionamento/shared';
import { api } from './api';

const consulta = (params: Record<string, string | undefined>) => {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])));
  return q.size ? `?${q}` : '';
};

export const usuariosApi = {
  listar: (f: { busca?: string; situacao?: string; nivel?: string }) =>
    api<Lista<FuncionarioResumo>>(`/usuarios${consulta(f)}`),
  obter: (id: string) => api<FuncionarioDetalhe>(`/usuarios/${id}`),
  criar: (dados: NovoFuncionario) => api<FuncionarioDetalhe>('/usuarios', { method: 'POST', corpo: dados }),
  atualizar: (id: string, dados: DadosFuncionario) =>
    api<FuncionarioDetalhe>(`/usuarios/${id}`, { method: 'PATCH', corpo: dados }),
  definirAcesso: (id: string, acesso: DadosAcesso) =>
    api<FuncionarioDetalhe>(`/usuarios/${id}/acesso`, { method: 'PUT', corpo: acesso }),
  desativar: (id: string, motivo: string) =>
    api<FuncionarioDetalhe>(`/usuarios/${id}/desativar`, { method: 'POST', corpo: { motivo } }),
  reativar: (id: string, motivo: string) =>
    api<FuncionarioDetalhe>(`/usuarios/${id}/reativar`, { method: 'POST', corpo: { motivo } }),
  redefinirSenha: (id: string, senhaProvisoria: string) =>
    api<FuncionarioDetalhe>(`/usuarios/${id}/redefinir-senha`, {
      method: 'POST',
      corpo: { senhaProvisoria },
    }),
  desbloquear: (id: string) => api<FuncionarioDetalhe>(`/usuarios/${id}/desbloquear`, { method: 'POST' }),
  catalogo: () => api<CatalogoPermissoes>('/permissoes'),
  atividades: (f: Record<string, string | undefined>) => api<PaginaAtividades>(`/atividades${consulta(f)}`),
};
