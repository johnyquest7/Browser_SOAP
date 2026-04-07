/*
  Minimal cross-origin isolation helper for static hosting, including GitHub Pages.
  It registers itself on the window side and, in service worker context, rewrites
  response headers to enable COOP/COEP.
*/

(() => {
  const isWorker = typeof window === 'undefined';

  if (isWorker) {
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener('fetch', (event) => {
      const request = event.request;
      if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
        return;
      }

      event.respondWith((async () => {
        const response = await fetch(request);
        if (response.type === 'opaque') {
          return response;
        }

        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })());
    });

    return;
  }

  if (window.crossOriginIsolated || !('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.register('./coi-serviceworker.js').then((registration) => {
    if (registration.active && !navigator.serviceWorker.controller) {
      window.location.reload();
      return;
    }

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!window.crossOriginIsolated) {
        window.location.reload();
      }
    });
  }).catch((error) => {
    console.error('Failed to register coi-serviceworker.js', error);
  });
})();
