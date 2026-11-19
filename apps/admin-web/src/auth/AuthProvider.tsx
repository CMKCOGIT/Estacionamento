import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { RequisicaoTrocaSenha, RespostaSessao, UsuarioAutenticado } from '@estacionamento/shared';
import { api, ErroDaApi, EVENTO_SESSAO_ENCERRADA, EVENTO_TROCA_SENHA } from '../services/api';
import { AuthContexto, type EstadoAuth } from './contexto';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioAutenticado | null>(null);
  const [verificando, setVerificando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);

  // Ao abrir o painel: já existe sessão válida neste navegador?
  useEffect(() => {
    api<RespostaSessao>('/auth/sessao', { ignorarSessao: true })
      .then((r) => setUsuario(r.usuario))
      .catch((e: unknown) => {
        if (e instanceof ErroDaApi && e.status !== 401) setAviso(e.message);
      })
      .finally(() => setVerificando(false));
  }, []);

  // Qualquer chamada que receba 401 encerra a sessão no painel.
  useEffect(() => {
    const aoEncerrar = (e: Event) => {
      setUsuario(null);
      setAviso((e as CustomEvent<string>).detail ?? 'Sua sessão terminou. Entre novamente.');
    };
    const aoExigirTroca = () => setUsuario((u) => (u ? { ...u, deveTrocarSenha: true } : u));
    window.addEventListener(EVENTO_SESSAO_ENCERRADA, aoEncerrar);
    window.addEventListener(EVENTO_TROCA_SENHA, aoExigirTroca);
    return () => {
      window.removeEventListener(EVENTO_SESSAO_ENCERRADA, aoEncerrar);
      window.removeEventListener(EVENTO_TROCA_SENHA, aoExigirTroca);
    };
  }, []);

  const entrar = useCallback(async (login: string, senha: string) => {
    const r = await api<RespostaSessao>('/auth/login', {
      method: 'POST',
      corpo: { login, senha },
      ignorarSessao: true,
    });
    setAviso(null);
    setUsuario(r.usuario);
  }, []);

  const sair = useCallback(async () => {
    await api<void>('/auth/logout', { method: 'POST', ignorarSessao: true }).catch(() => undefined);
    setUsuario(null);
    setAviso('Você saiu do sistema.');
  }, []);

  const trocarSenha = useCallback(async (dados: RequisicaoTrocaSenha) => {
    await api<void>('/auth/trocar-senha', { method: 'POST', corpo: dados });
    setUsuario((u) => (u ? { ...u, deveTrocarSenha: false } : u));
  }, []);

  const valor = useMemo<EstadoAuth>(() => {
    const permissoes = new Set(usuario?.permissoes ?? []);
    return {
      usuario,
      verificando,
      aviso,
      entrar,
      sair,
      trocarSenha,
      temPermissao: (...codigos) => codigos.length === 0 || codigos.some((c) => permissoes.has(c)),
    };
  }, [usuario, verificando, aviso, entrar, sair, trocarSenha]);

  return <AuthContexto.Provider value={valor}>{children}</AuthContexto.Provider>;
}
