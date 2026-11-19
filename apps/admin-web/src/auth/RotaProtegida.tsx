import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './contexto';

interface Props {
  children: ReactNode;
  /** Se informado, exige UMA destas permissões (níveis de acesso). */
  permissoes?: string[];
}

/**
 * Bloqueia a tela para quem não está logado (vai para /login) e força a troca
 * de senha pendente. O servidor faz as mesmas verificações em cada chamada:
 * isto é só para a navegação ficar coerente.
 */
export function RotaProtegida({ children, permissoes = [] }: Props) {
  const { usuario, verificando, temPermissao } = useAuth();
  const local = useLocation();

  if (verificando) return <div className="tela-carregando">Carregando…</div>;
  if (!usuario) return <Navigate to="/login" replace state={{ de: local.pathname }} />;
  if (usuario.deveTrocarSenha && local.pathname !== '/trocar-senha')
    return <Navigate to="/trocar-senha" replace />;
  if (!temPermissao(...permissoes)) {
    return (
      <div className="cartao">
        <h2>Acesso negado</h2>
        <p className="mudo">Seu perfil não tem permissão para esta tela. Fale com o administrador.</p>
      </div>
    );
  }
  return children;
}
