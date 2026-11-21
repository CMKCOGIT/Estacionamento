import { api } from './api';

export type Nivel = 'OK' | 'ATENCAO' | 'FALHA' | 'DESLIGADO';
export interface Componente {
  nivel: Nivel;
  resumo: string;
  detalhes: Record<string, string | number | boolean | null>;
  acao?: string;
}
export interface PainelMonitoramento {
  geradoEm: string;
  geral: Nivel;
  alertas: { nivel: Nivel; componente: string; mensagem: string; acao?: string }[];
  componentes: {
    servidor: Componente;
    banco: Componente;
    internet: Componente;
    apiExterna: Componente;
    sincronizacao: Componente;
    backup: Componente;
  };
  falhasComunicacao: { em: string; tipo: string; erro: string | null; httpStatus: number | null }[];
  errosRecentes: {
    em: string;
    origem: string;
    codigo: string | null;
    mensagem: string;
    rota: string | null;
  }[];
  contagens: { errosUltimas24h: number; falhasSyncUltimas24h: number };
}

export const monitoramentoApi = {
  painel: () => api<PainelMonitoramento>('/monitoramento'),
};
