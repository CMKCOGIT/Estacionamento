import type {
  EncarregadoDados,
  NovaSolicitacaoLgpd,
  PoliticaRetencao,
  RelatorioTitular,
  ResultadoAnonimizacao,
  ResultadoRetencao,
  SolicitacaoLgpd,
  StatusSolicitacaoLgpd,
} from '@estacionamento/shared';
import { api } from './api';

const q = (placa: string) => `placa=${encodeURIComponent(placa)}`;

export const privacidadeApi = {
  relatorio: (placa: string) => api<RelatorioTitular>(`/privacidade/titular?${q(placa)}`),
  /** Portabilidade: baixa o JSON pelo próprio navegador (o cookie de sessão vai junto). */
  urlExportacao: (placa: string) => `/api/v1/privacidade/titular/exportar?${q(placa)}`,
  anonimizar: (placa: string, motivo: string) =>
    api<ResultadoAnonimizacao>('/privacidade/titular/anonimizar', {
      method: 'POST',
      corpo: { placa, motivo, confirmacao: true },
    }),
  solicitacoes: () => api<{ itens: SolicitacaoLgpd[] }>('/privacidade/solicitacoes'),
  registrar: (d: NovaSolicitacaoLgpd) =>
    api<SolicitacaoLgpd>('/privacidade/solicitacoes', { method: 'POST', corpo: d }),
  atualizar: (id: string, d: { status: StatusSolicitacaoLgpd; resposta?: string | null }) =>
    api<SolicitacaoLgpd>(`/privacidade/solicitacoes/${id}`, { method: 'PATCH', corpo: d }),
  retencao: () =>
    api<{ politica: PoliticaRetencao; ultimaExecucao: ResultadoRetencao | null }>('/privacidade/retencao'),
  salvarRetencao: (p: PoliticaRetencao) =>
    api<{ politica: PoliticaRetencao }>('/privacidade/retencao', { method: 'PUT', corpo: p }),
  executarRetencao: () =>
    api<ResultadoRetencao>('/privacidade/retencao/executar', { method: 'POST', corpo: {} }),
  encarregado: () => api<EncarregadoDados>('/privacidade/encarregado'),
  salvarEncarregado: (e: EncarregadoDados) =>
    api<EncarregadoDados>('/privacidade/encarregado', { method: 'PUT', corpo: e }),
};
