import { baixarExcel } from '../exportar';

/**
 * Planilha do relatório: arquivo Excel (.xlsx). O nome "csv" ficou por
 * compatibilidade com quem já chamava esta função.
 */
export function baixarCsv(nome: string, cabecalho: string[], linhas: (string | number | null)[][]) {
  baixarExcel(nome, [{ nome: 'Relatório', cabecalho, linhas }]);
}

/** 1850 → 18.5 (número: o Excel soma e formata). */
export const reaisCsv = (centavos: number | null) => (centavos === null ? null : Math.round(centavos) / 100);
