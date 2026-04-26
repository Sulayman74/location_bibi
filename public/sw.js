/**
 * Service Worker – La Cabine du Cap d'Agde
 * Stratégie: Cache-First pour assets statiques, Network-First pour données Firestore
 */

const CACHE_VERSION = 'v1.0.6';
const STATIC_CACHE = `villa-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `villa-dynamic-${CACHE_VERSION}`;
const IMAGE_CACHE  = `villa-images-${CACHE_VERSION}`;

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/reservation.html',
  '/guest.html',
  '/offline.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@400;600;700&display=swap',
];

// Network-first routes (always try network for fresh data)
const NETWORK_FIRST_PATTERNS = [
  /firestore\.googleapis\.com/,
  /firebase\.googleapis\.com/,
  /cloudfunctions\.net/,
  /\/api\//,
];

// Cache-first routes (serve from cache, update in background)
const CACHE_FIRST_PATTERNS = [
  /fonts\.(googleapis|gstatic)\.com/,
  /cdn\.tailwindcss\.com/,
  /js\.stripe\.com/,
  /images\.unsplash\.com/,
  /\.(png|jpg|jpeg|webp|svg|ico|woff|woff2)$/,
];

// ==================== INSTALL ====================
self.addEventListener('install', event => {
  console.log('[SW] Installing…');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      // 👇 MODIFICATION ICI : On utilise Promise.all au lieu de cache.addAll
      .then(cache => Promise.all(PRECACHE_ASSETS.map(url => {
        // Don't fail install if external resources are unavailable
        return cache.add(url).catch(err => console.warn('[SW] Pre-cache failed for', url, err));
      })))
      .then(() => self.skipWaiting())
  );
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', event => {
  console.log('[SW] Activating…');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => ![STATIC_CACHE, DYNAMIC_CACHE, IMAGE_CACHE].includes(key))
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ==================== FETCH ====================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and chrome-extension requests
  if (request.method !== 'GET' || url.protocol === 'chrome-extension:') return;

  // Network-first for API/Firestore calls
  if (NETWORK_FIRST_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cache-first for images
  if (/\.(png|jpg|jpeg|webp|svg|gif)$/.test(url.pathname) || url.hostname === 'images.unsplash.com') {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  // Cache-first for static assets (fonts, CDN)
  if (CACHE_FIRST_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Network-first for HTML pages (navigation) — jamais de HTML périmé
  if (request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cache-first pour les assets hashés Vite (ex: main-abc123.js)
  if (/\/assets\/.*\.[a-f0-9]{8,}\.(js|css)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Stale-while-revalidate pour tout le reste
  event.respondWith(staleWhileRevalidate(request));
});

// ==================== STRATEGIES ====================

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match('/offline.html');
  }
}

async function cacheFirst(request, cacheName = STATIC_CACHE) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return caches.match('/offline.html');
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const networkPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(DYNAMIC_CACHE).then(c => c.put(request, clone));
      }
      return response;
    })
    .catch(() => cached || caches.match('/offline.html'));

  return cached || networkPromise;
}

// ==================== PUSH NOTIFICATIONS ====================
self.addEventListener('push', event => {
  if (!event.data) return;

  let data;
  try { data = event.data.json(); }
  catch { data = { title: "La Cabine du Cap d'Agde", body: event.data.text() }; }

  const options = {
    body: data.body || '',
    icon: '/assets/icons/favicon-192.png',
    badge: '/assets/icons/favicon-96.png',
    tag: data.tag || 'villa-notification',
    renotify: true,
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || [],
    data: data.data || {},
    vibrate: [100, 50, 100],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "La Cabine du Cap d'Agde", options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/guest.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        const existing = clientList.find(c => c.url.includes(url));
        if (existing) return existing.focus();
        return clients.openWindow(url);
      })
  );
});

// ==================== BACKGROUND SYNC ====================
self.addEventListener('sync', event => {
  if (event.tag === 'sync-booking') {
    event.waitUntil(syncPendingBookings());
  }
});

async function syncPendingBookings() {
  const pending = JSON.parse(localStorage?.getItem?.('pending_bookings') || '[]');
  for (const booking of pending) {
    try {
      await fetch('/api/bookings', { method: 'POST', body: JSON.stringify(booking), headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      console.error('[SW] Sync failed for booking', e);
    }
  }
}

// ==================== MESSAGE HANDLER ====================
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CACHE_WIFI') {
    // Persist WiFi data through service worker message
    const { ssid, password } = event.data;
    caches.open(DYNAMIC_CACHE).then(cache => {
      const response = new Response(JSON.stringify({ ssid, password, cachedAt: Date.now() }), {
        headers: { 'Content-Type': 'application/json' }
      });
      cache.put('/cached-wifi-data', response);
    });
  }
});
