/**
 * Proteção de dados pessoais em textos que saem do sistema (logs, mensagens
 * de erro registradas). LGPD: o log é para diagnóstico, não para guardar
 * quem estacionou. Os padrões usam limites de palavra para não estragar
 * identificadores (ULIDs contêm sequências parecidas com placas).
 */
const PADROES: [RegExp, string][] = [
  // E-mail
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[e-mail]'],
  // CPF (000.000.000-00 ou 11 dígitos) e CNPJ
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[cpf]'],
  [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '[cnpj]'],
  [/(?<![\d.])\d{11}(?![\d.])/g, '[documento]'],
  [/(?<![\d.])\d{14}(?![\d.])/g, '[documento]'],
  // Telefone: (11) 91234-5678, 11 91234-5678, +55 11 912345678
  [/(?:\+55\s?)?\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, '[telefone]'],
  // Placas: Mercosul (ABC1D23) e antiga (ABC-1234 / ABC1234), com ou sem hífen
  [/\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/g, '[placa]'],
];

export function mascararDadosPessoais(texto: string): string {
  let t = texto;
  for (const [re, troca] of PADROES) t = t.replace(re, troca);
  return t;
}

/** Aplica a máscara em todas as strings de um objeto (para logs estruturados). */
export function mascararObjeto<T>(v: T, profundidade = 0): T {
  if (profundidade > 6 || v === null || v === undefined) return v;
  if (typeof v === 'string') return mascararDadosPessoais(v) as T;
  if (Array.isArray(v)) return v.map((x) => mascararObjeto(x, profundidade + 1)) as T;
  // Só objetos simples: Error, Date, requisições HTTP etc. passam intactos (têm serializador próprio)
  const proto = typeof v === 'object' ? Object.getPrototypeOf(v) : undefined;
  if (proto === Object.prototype || proto === null) {
    const saida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>))
      saida[k] = mascararObjeto(x, profundidade + 1);
    return saida as T;
  }
  return v;
}

/** "123.***.***-01": mostra só o suficiente para conferir com o titular. */
export function mascararCpf(cpf: string | null | undefined): string | null {
  if (!cpf) return null;
  const d = cpf.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.***.***-${d.slice(9)}` : '***';
}
