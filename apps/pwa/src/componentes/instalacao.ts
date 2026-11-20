import { useEffect, useState } from 'react';

interface EventoInstalar extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const jaInstalado = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;
/** iPhone/iPad no Safari não tem botão de instalar: só "Compartilhar → Adicionar à Tela de Início". */
const ehIosSafari = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);

/** Estado da instalação na tela inicial. */
export function useInstalacao() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null);
  const [instalado, setInstalado] = useState(jaInstalado);
  useEffect(() => {
    const antes = (e: Event) => {
      e.preventDefault(); // nós mostramos o convite, na hora certa
      setEvento(e as EventoInstalar);
    };
    const depois = () => {
      setInstalado(true);
      setEvento(null);
    };
    window.addEventListener('beforeinstallprompt', antes);
    window.addEventListener('appinstalled', depois);
    return () => {
      window.removeEventListener('beforeinstallprompt', antes);
      window.removeEventListener('appinstalled', depois);
    };
  }, []);
  return {
    instalado,
    podeInstalar: !!evento,
    ios: !instalado && ehIosSafari(),
    instalar: async () => {
      if (!evento) return;
      await evento.prompt();
      await evento.userChoice;
      setEvento(null);
    },
  };
}

/** Online/offline do celular. */
export function useConexao() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
