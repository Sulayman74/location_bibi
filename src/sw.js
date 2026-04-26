/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute, setCatchHandler } from 'workbox-routing'
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

self.skipWaiting()
self.clients.claim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

registerRoute(
  ({ url }) =>
    /firestore\.googleapis\.com|firebase\.googleapis\.com|cloudfunctions\.net/.test(url.hostname) ||
    url.pathname.startsWith('/api/'),
  new NetworkFirst({ cacheName: 'villa-api', networkTimeoutSeconds: 5 }),
)

registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({
    cacheName: 'villa-html',
    networkTimeoutSeconds: 3,
    plugins: [new CacheableResponsePlugin({ statuses: [200] })],
  }),
)

registerRoute(
  ({ url }) => /fonts\.(googleapis|gstatic)\.com/.test(url.hostname),
  new CacheFirst({
    cacheName: 'villa-fonts',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  }),
)

registerRoute(
  ({ request, url }) =>
    request.destination === 'image' || url.hostname === 'images.unsplash.com',
  new CacheFirst({
    cacheName: 'villa-images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
)

registerRoute(
  ({ url }) => /js\.stripe\.com/.test(url.hostname),
  new StaleWhileRevalidate({ cacheName: 'villa-stripe' }),
)

setCatchHandler(async ({ request }) => {
  if (request.destination === 'document') {
    const cache = await caches.open('villa-html')
    const offline = await cache.match('/offline.html')
    if (offline) return offline
    const precached = await caches.match('/offline.html')
    if (precached) return precached
  }
  return Response.error()
})

self.addEventListener('push', event => {
  if (!event.data) return
  let data
  try { data = event.data.json() }
  catch { data = { title: "La Cabine du Cap d'Agde", body: event.data.text() } }

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
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "La Cabine du Cap d'Agde", options),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/guest.html'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const existing = clientList.find(c => c.url.includes(url))
      if (existing) return existing.focus()
      return self.clients.openWindow(url)
    }),
  )
})

self.addEventListener('sync', event => {
  if (event.tag === 'sync-booking') {
    event.waitUntil(syncPendingBookings())
  }
})

async function syncPendingBookings() {
  const pending = JSON.parse(self.localStorage?.getItem?.('pending_bookings') || '[]')
  for (const booking of pending) {
    try {
      await fetch('/api/bookings', {
        method: 'POST',
        body: JSON.stringify(booking),
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (e) {
      console.error('[SW] Sync failed for booking', e)
    }
  }
}

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
  if (event.data?.type === 'CACHE_WIFI') {
    const { ssid, password } = event.data
    caches.open('villa-wifi').then(cache => {
      const response = new Response(
        JSON.stringify({ ssid, password, cachedAt: Date.now() }),
        { headers: { 'Content-Type': 'application/json' } },
      )
      cache.put('/cached-wifi-data', response)
    })
  }
})
