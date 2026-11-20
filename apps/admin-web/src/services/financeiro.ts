import type {
  CaixaDetalhe,
  CaixaResumo,
  Lista,
  ListaMovimentacoes,
  ListaPagamentos,
  ListaPendencias,
  PedidoMovimentacaoCaixa,
  PedidoPagamento,
  ResultadoPagamento,
  ResumoFinanceiroDia,
  SessaoDetalhe,
  CaixaAtual,
} from '@estacionamento/shared';
import { api } from './api';

const query = (f: Record<string, string | number | undefined | null>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  return q.size ? `?${q}` : '';
};

export const financeiroApi = {
  resumo: (data?: string) => api<ResumoFinanceiroDia>(`/financeiro/resumo${query({ data })}`),
  pagamentos: (f: {
    de?: string;
    ate?: string;
    forma?: string;
    status?: string;
    busca?: string;
    pagina?: number;
  }) => api<ListaPagamentos>(`/financeiro/pagamentos${query({ ...f, limite: 50 })}`),
  pendentes: () => api<ListaPendencias>('/financeiro/pendentes'),
  movimentacoes: (f: {
    de?: string;
    ate?: string;
    tipo?: string;
    forma?: string;
    caixaId?: string;
    pagina?: number;
  }) => api<ListaMovimentacoes>(`/financeiro/movimentacoes${query({ ...f, limite: 100 })}`),
  caixas: (f: { de?: string; ate?: string } = {}) => api<Lista<CaixaResumo>>(`/financeiro/caixas${query(f)}`),
  caixa: (id: string) => api<CaixaDetalhe>(`/financeiro/caixas/${id}`),
  fecharCaixa: (id: string, saldoContadoCentavos: number, observacao: string | null) =>
    api<{ esperadoCentavos: number; contadoCentavos: number; diferencaCentavos: number }>(
      `/financeiro/caixas/${id}/fechar`,
      {
        method: 'POST',
        corpo: { saldoContadoCentavos, observacao },
      },
    ),
  estornar: (pagamentoId: string, motivo: string) =>
    api<SessaoDetalhe>(`/financeiro/pagamentos/${pagamentoId}/estornar`, {
      method: 'POST',
      corpo: { motivo },
    }),
  receber: (sessaoId: string, p: PedidoPagamento) =>
    api<ResultadoPagamento>(`/sessoes/${sessaoId}/pagamentos`, { method: 'POST', corpo: p }),
  movimentarCaixa: (p: PedidoMovimentacaoCaixa) =>
    api<CaixaAtual>('/caixa/movimentar', { method: 'POST', corpo: p }),
};
