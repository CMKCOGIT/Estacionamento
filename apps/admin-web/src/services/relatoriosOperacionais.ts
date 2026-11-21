import type {
  HistoricoPlaca,
  IndicadoresOperacionais,
  MovimentoFuncionario,
  OpcaoFuncionario,
  RelatorioBloqueios,
  RelatorioMovimento,
  RelatorioOcupacao,
  VeiculoEstacionado,
} from '@estacionamento/shared';
import { api } from './api';

export interface FiltrosAdm {
  de: string;
  ate: string;
  placa?: string;
  operadorId?: string;
  situacao?: string;
}
const q = (f: Record<string, string | undefined>) =>
  `?${new URLSearchParams(Object.entries(f).filter((e): e is [string, string] => Boolean(e[1]))).toString()}`;
const B = '/relatorios/operacional';

export const relatoriosAdmApi = {
  funcionarios: () => api<{ itens: OpcaoFuncionario[] }>(`${B}/funcionarios`),
  movimento: (f: FiltrosAdm) => api<RelatorioMovimento>(`${B}/movimento${q({ ...f })}`),
  estacionados: (f: Pick<FiltrosAdm, 'placa' | 'operadorId'>) =>
    api<{ itens: VeiculoEstacionado[] }>(`${B}/estacionados${q({ ...f })}`),
  placa: (placa: string) => api<HistoricoPlaca>(`${B}/placa${q({ placa })}`),
  ocupacao: (f: FiltrosAdm) => api<RelatorioOcupacao>(`${B}/ocupacao${q({ de: f.de, ate: f.ate })}`),
  bloqueios: (f: FiltrosAdm) =>
    api<RelatorioBloqueios>(`${B}/bloqueios${q({ de: f.de, ate: f.ate, operadorId: f.operadorId })}`),
  porFuncionario: (f: FiltrosAdm) =>
    api<{ itens: MovimentoFuncionario[] }>(
      `${B}/funcionarios/movimento${q({ de: f.de, ate: f.ate, operadorId: f.operadorId })}`,
    ),
  indicadores: (f: FiltrosAdm) =>
    api<IndicadoresOperacionais>(`${B}/indicadores${q({ de: f.de, ate: f.ate })}`),
};
