import { createContext, useContext } from 'react';
import type { RegrasSenha, RequisicaoTrocaSenha, UsuarioAutenticado } from '@estacionamento/shared';

export interface EstadoAuth {
  usuario: UsuarioAutenticado | null;
  /** Regras de senha definidas pelo administrador (Configurações → Segurança). */
  regrasSenha: RegrasSenha | null;
  /** true enquanto verifica se já existe sessão (ao abrir o painel). */
  verificando: boolean;
  /** Mensagem mostrada na tela de login (ex.: "sessão expirou"). */
  aviso: string | null;
  entrar(login: string, senha: string): Promise<void>;
  sair(): Promise<void>;
  trocarSenha(dados: RequisicaoTrocaSenha): Promise<void>;
  temPermissao(...codigos: string[]): boolean;
}

export const AuthContexto = createContext<EstadoAuth | null>(null);

export function useAuth(): EstadoAuth {
  const ctx = useContext(AuthContexto);
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>');
  return ctx;
}
