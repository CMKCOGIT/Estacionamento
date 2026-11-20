import type {
  Agrupamento,
  DetalheMovimentacao,
  RelatorioFaturamento,
  RelatorioFechamentos,
  RelatorioFormas,
  RelatorioPendentes,
} from '@estacionamento/shared';
import { api } from './api';

export const relatoriosApi = {
  faturamento: (de: string, ate: string, agrupar: Agrupamento) =>
    api<RelatorioFaturamento>(`/relatorios/faturamento?de=${de}&ate=${ate}&agrupar=${agrupar}`),
  formas: (de: string, ate: string) => api<RelatorioFormas>(`/relatorios/formas?de=${de}&ate=${ate}`),
  pendentes: () => api<RelatorioPendentes>('/relatorios/pendentes'),
  fechamentos: (de: string, ate: string) =>
    api<RelatorioFechamentos>(`/relatorios/fechamentos?de=${de}&ate=${ate}`),
  detalhe: (o: { movimentacaoId?: string; pagamentoId?: string }) =>
    api<DetalheMovimentacao>(
      `/relatorios/detalhe?${o.movimentacaoId ? `movimentacaoId=${o.movimentacaoId}` : `pagamentoId=${o.pagamentoId}`}`,
    ),
};
