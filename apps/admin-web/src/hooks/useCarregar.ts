import { useCallback, useEffect, useState } from 'react';

interface Estado<T> {
  dados: T | null;
  erro: Error | null;
  carregando: boolean;
  recarregar: () => void;
}

/** Executa uma função assíncrona ao montar a tela e expõe carregando/erro/dados. */
export function useCarregar<T>(carregar: () => Promise<T>): Estado<T> {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<Error | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let ativo = true;
    carregar()
      .then((r) => {
        if (!ativo) return;
        setDados(r);
        setErro(null);
      })
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [carregar, versao]);

  const recarregar = useCallback(() => {
    setCarregando(true);
    setVersao((v) => v + 1);
  }, []);

  return { dados, erro, carregando, recarregar };
}
