import { api } from './api';

export interface RegistroBackup {
  id: string;
  tipo: string;
  status: 'EM_ANDAMENTO' | 'SUCESSO' | 'FALHA';
  iniciadoEm: string;
  concluidoEm: string | null;
  duracaoMs: number | null;
  arquivo: string | null;
  tamanhoBytes: number | null;
  tabelas: number | null;
  copiaEm: string | null;
  verificadoEm: string | null;
  verificacao: 'OK' | 'CORROMPIDO' | 'AUSENTE' | null;
  restauracaoTestadaEm: string | null;
  removidoEm: string | null;
  erro: string | null;
}
export interface SituacaoBackups {
  ativo: boolean;
  pasta: string;
  copia: string | null;
  horario: string;
  proximoEm: string;
  chaveId: string;
  chaveNoArquivo: boolean;
  retencao: { diarios: number; semanais: number; mensais: number };
  emAndamento: boolean;
  ultimoSucesso: RegistroBackup | null;
  ultimaFalha: RegistroBackup | null;
  guardados: number;
  bytesGuardados: number;
  comProblema: number;
  ultimaRestauracao: {
    arquivo: string;
    backupSeguranca: string | null;
    em: string;
    por: string | null;
  } | null;
}

export const backupsApi = {
  listar: () => api<{ situacao: SituacaoBackups; itens: RegistroBackup[] }>('/backups'),
  criar: () => api<RegistroBackup>('/backups', { method: 'POST', corpo: {} }),
  verificar: (id: string) => api<RegistroBackup>(`/backups/${id}/verificar`, { method: 'POST', corpo: {} }),
  testar: (id: string) =>
    api<{ ok: boolean; tabelas: number; detalhe: string }>(`/backups/${id}/testar-restauracao`, {
      method: 'POST',
      corpo: {},
    }),
  /** Endereço para baixar o arquivo (o navegador envia o cookie de sessão). */
  urlArquivo: (id: string) => `/api/v1/backups/${id}/arquivo`,
  restaurar: (id: string, senha: string) =>
    api<{ arquivo: string; backupSeguranca: string; tabelas: number; migracoes: string[] }>(
      `/backups/${id}/restaurar`,
      { method: 'POST', corpo: { senha, confirmacao: 'RESTAURAR' } },
    ),
};
