/** Planilha CSV para abrir no Excel (separador ";" e vírgula decimal, como no Brasil). */
export function baixarCsv(nome: string, cabecalho: string[], linhas: (string | number | null)[][]) {
  const celula = (v: string | number | null) => {
    const t = v === null ? '' : String(v);
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const conteudo = [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n');
  const blob = new Blob(['﻿', conteudo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Sem acentos nem espaços: alguns navegadores trocam nomes assim por "download"
  a.download = `${nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 1850 → "18,50" (número para planilha). */
export const reaisCsv = (centavos: number | null) =>
  centavos === null ? null : (centavos / 100).toFixed(2).replace('.', ',');
