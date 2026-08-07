/* Service worker — modo sin conexión y recordatorios de pago.
 *
 * Aquí NUNCA salen datos del teléfono: lee IndexedDB solo para saber qué
 * tarjeta toca y muestra una notificación local. No hay red de por medio.
 */

const CACHE = 'finanzas-v3';

const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/atajo-mas.png',
  './icons/atajo-menos.png',
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

/* ── Recordatorios de tarjetas ──────────────────────── */

const DB_NAME = 'consultorio-finanzas';

function abrirDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function leerCfg(db, k) {
  return new Promise((resolve) => {
    try {
      const req = db.transaction('cfg', 'readonly').objectStore('cfg').get(k);
      req.onsuccess = () => resolve(req.result ? req.result.v : undefined);
      req.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

function escribirCfg(db, k, v) {
  return new Promise((resolve) => {
    try {
      const t = db.transaction('cfg', 'readwrite');
      t.objectStore('cfg').put({ k, v });
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
    } catch { resolve(); }
  });
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Mismos cálculos que la app: días hasta el próximo día `dia` del mes. */
function diasParaDia(dia) {
  const hoy = new Date();
  const diaHoy = hoy.getDate();
  const ultimoDeEste = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const objetivoEste = Math.min(dia, ultimoDeEste);
  if (diaHoy <= objetivoEste) return objetivoEste - diaHoy;
  const ultimoDelQue = new Date(hoy.getFullYear(), hoy.getMonth() + 2, 0).getDate();
  const objetivoSig = Math.min(dia, ultimoDelQue);
  const fSig = new Date(hoy.getFullYear(), hoy.getMonth() + 1, objetivoSig);
  return Math.round((fSig - new Date(hoy.getFullYear(), hoy.getMonth(), diaHoy)) / 86400000);
}

async function revisarPagos() {
  let db;
  try { db = await abrirDB(); } catch { return; }

  const comp = await leerCfg(db, 'compromisos');
  if (!comp) return;

  const ya = (await leerCfg(db, 'notificado')) || {};
  const hoy = hoyISO();
  let cambio = false;

  for (const ambito of Object.keys(comp)) {
    for (const t of (comp[ambito] && comp[ambito].tarjetas) || []) {
      const d = diasParaDia(t.diaPago);
      if (d > (t.aviso == null ? 3 : t.aviso)) continue;
      if (ya[t.id] === hoy) continue;
      await self.registration.showNotification(
        d === 0 ? `Hoy se paga ${t.nombre}` : `${t.nombre}: faltan ${d} días`,
        {
          body: d === 0 ? `Día límite de pago: ${t.diaPago}.` : `Día límite: ${t.diaPago} de cada mes.`,
          tag: 'tarjeta-' + t.id,
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          data: { url: './' },
        },
      );
      ya[t.id] = hoy;
      cambio = true;
    }
  }

  if (cambio) await escribirCfg(db, 'notificado', ya);
}

// Chrome despierta esto cuando él decide, no cuando nosotros queremos.
// Por eso la app también revisa al abrirse: entre las dos, no se escapa.
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'revisar-pagos') e.waitUntil(revisarPagos());
});

self.addEventListener('sync', (e) => {
  if (e.tag === 'revisar-pagos') e.waitUntil(revisarPagos());
});

self.addEventListener('notificationclick', (e) => {
  // La barra rápida no se cierra al tocar sus botones: sigue ahí para la próxima.
  const esBarra = e.notification.tag === 'barra-rapida';
  if (!esBarra) e.notification.close();

  // Los botones + y − abren la app con el tipo ya elegido.
  const destino = e.action === 'ingreso' ? './?t=ingreso'
    : e.action === 'egreso' ? './?t=egreso'
      : './';

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if ('focus' in c) {
          if (e.action && 'navigate' in c) return c.navigate(destino).then((cl) => cl && cl.focus());
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(destino);
    }),
  );
});
