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
        const avisar = (sw: ServiceWorker | null) => {
          if (sw && navigator.serviceWorker.controller)
            onNovaVersao(() => sw.postMessage('ativar-nova-versao'));
        };
        avisar(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const novo = reg.installing;
          novo?.addEventListener('statechange', () => novo.state === 'installed' && avisar(novo));
        });
        // Procura atualização ao voltar para o app
        document.addEventListener(
          'visibilitychange',
          () => document.visibilityState === 'visible' && void reg.update(),
        );
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
