/** Contratos do módulo de autenticação (servidor local ↔ painel). */

export interface PerfilResumo {
  codigo: string;
  nome: string;
}

export interface UsuarioAutenticado {
  id: string;
  login: string;
  nome: string;
  siteId: string;
  perfis: PerfilResumo[];
  /** Códigos de permissão, ex.: "sessao.entrada" (ver tabela permissoes). */
  permissoes: string[];
  deveTrocarSenha: boolean;
}

export interface RequisicaoLogin {
  login: string;
  senha: string;
}

export interface RespostaSessao {
  usuario: UsuarioAutenticado;
  /** Fim absoluto da sessão (ISO 8601). */
  expiraEm: string;
  /** Minutos sem uso até a sessão expirar. */
  inatividadeMinutos: number;
}

export interface RequisicaoTrocaSenha {
  senhaAtual: string;
  novaSenha: string;
}

/** Regras de senha — validadas no painel (feedback imediato) e no servidor. */
export const POLITICA_SENHA = {
  minimo: 8,
  maximo: 128,
} as const;

export function problemasDaSenha(senha: string, login?: string): string[] {
  const problemas: string[] = [];
  if (senha.length < POLITICA_SENHA.minimo)
    problemas.push(`Use pelo menos ${POLITICA_SENHA.minimo} caracteres`);
  if (senha.length > POLITICA_SENHA.maximo)
    problemas.push(`Use no máximo ${POLITICA_SENHA.maximo} caracteres`);
  if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/[0-9]/.test(senha)) problemas.push('Combine letras e números');
  if (login && senha.toLowerCase().includes(login.toLowerCase()))
    problemas.push('A senha não pode conter o login');
  return problemas;
}
