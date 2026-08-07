/* Service worker — hace que la app abra sin internet.
 *
 * Estrategia: cache-first para el armazón de la app (siempre son los mismos
 * cuatro archivos), y red-primero solo para el HTML, para que una versión
 * nueva se note al siguiente arranque.
 *
 * Aquí NUNCA pasan datos del usuario: los movimientos viven en IndexedDB,
 * que el service worker ni toca.
 */

const CACHE = 'finanzas-v1';

const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // El HTML se pide primero a la red para detectar versiones nuevas;
  // si no hay señal, sale del cache.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copia)).catch(() => {});
          return r;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((r) => {
        if (r && r.status === 200 && r.type === 'basic') {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        }
        return r;
      });
    }),
  );
});
