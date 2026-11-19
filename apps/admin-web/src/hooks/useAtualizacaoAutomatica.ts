import { useCallback, useEffect, useRef, useState } from 'react';

interface Estado<T> {
  dados: T | null;
  /** Erro da ÚLTIMA tentativa (os dados anteriores continuam disponíveis). */
  erro: Error | null;
  /** Buscando agora (primeira carga ou atualização). */
  atualizando: boolean;
  atualizadoEm: Date | null;
  atualizarAgora: () => void;
}

/**
 * Busca `carregar` ao montar e depois a cada `intervaloMs`.
 * - Pausa enquanto a aba está escondida e atualiza assim que ela volta.
 * - Uma busca de cada vez; respostas que chegam depois de desmontar são descartadas.
 * - Em caso de erro mantém os últimos dados (o painel avisa que estão desatualizados).
 */
export function useAtualizacaoAutomatica<T>(carregar: () => Promise<T>, intervaloMs: number): Estado<T> {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<Error | null>(null);
  const [atualizando, setAtualizando] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [rodada, setRodada] = useState(0);
  const emAndamento = useRef(false);

  useEffect(() => {
    let ativo = true;
    // A trava evita disparar outra busca pelo timer; o efeito sempre busca
    // (no modo de desenvolvimento do React ele roda duas vezes e a 1ª é descartada).
    emAndamento.current = true;
    carregar()
      .then((r) => {
        if (!ativo) return;
        setDados(r);
        setErro(null);
        setAtualizadoEm(new Date());
      })
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        emAndamento.current = false;
        if (ativo) setAtualizando(false);
      });
    return () => {
      ativo = false;
    };
  }, [carregar, rodada]);

  const atualizarAgora = useCallback(() => {
    if (emAndamento.current) return;
    setAtualizando(true);
    setRodada((r) => r + 1);
  }, []);

  // Agenda a próxima atualização; não roda com a aba escondida.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) atualizarAgora();
    }, intervaloMs);
    const aoVoltar = () => {
      if (!document.hidden) atualizarAgora();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [intervaloMs, atualizarAgora]);

  return { dados, erro, atualizando, atualizadoEm, atualizarAgora };
}
