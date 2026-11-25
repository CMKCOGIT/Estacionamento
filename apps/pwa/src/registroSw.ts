/**
 * Registra o service worker (só no app publicado: em desenvolvimento o cache
 * atrapalharia) e avisa quando há uma versão nova esperando.
 */
export function registrarServiceWorker(onNovaVersao: (ativar: () => void) => void) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        const aberto = Date.now();
        const avisar = (sw: ServiceWorker | null) => {
          if (!sw || !navigator.serviceWorker.controller) return;
          const ativar = () => sw.postMessage('ativar-nova-versao');
          // Logo ao abrir o app (ninguém está usando ainda): atualiza sozinho.
          // Com o app em uso, só avisa — o cliente escolhe a hora.
          if (Date.now() - aberto < 10_000) ativar();
          else onNovaVersao(ativar);
        };
        const acompanhar = (novo: ServiceWorker | null) =>
          novo?.addEventListener('statechange', () => novo.state === 'installed' && avisar(novo));
        avisar(reg.waiting);
        // A versão nova pode já estar sendo instalada ao abrir o app (o navegador
        // confere sozinho ao carregar): sem isto, o aviso só apareceria na próxima abertura
        acompanhar(reg.installing);
        reg.addEventListener('updatefound', () => acompanhar(reg.installing));
        // Procura atualização ao voltar para o app e a cada 15 minutos com ele aberto
        // (no iPhone, o app instalado fica "pausado" e não recarrega sozinho)
        document.addEventListener(
          'visibilitychange',
          () => document.visibilityState === 'visible' && void reg.update().catch(() => undefined),
        );
        setInterval(() => void reg.update().catch(() => undefined), 15 * 60_000);
      })
      .catch(() => undefined);
    // Recarrega só na troca de versão (no primeiro acesso o worker assume sem precisar recarregar)
    const tinhaVersaoAnterior = !!navigator.serviceWorker.controller;
    let recarregou = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (tinhaVersaoAnterior && !recarregou) {
        recarregou = true;
        window.location.reload();
      }
    });
  });
}
