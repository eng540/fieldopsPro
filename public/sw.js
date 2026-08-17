// FieldOps V4 — Service Worker
// Deployment-safe offline support.
// Next.js HTML/chunks are never cached. This prevents an old deployment
// from being combined with a new deployment and causing ChunkLoadError or
// stale-runtime failures after release.

const CACHE_NAME = 'fieldops-v4-runtime-v4'
const LEGACY_CACHE_PREFIX = 'fieldops-v4-'
const STATIC_ASSETS = ['/logo.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name.startsWith(LEGACY_CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  if (url.pathname === '/sw.js') return

  // Never cache Next.js documents or build-specific chunks.
  if (url.pathname.startsWith('/_next/')) {
    event.respondWith(fetch(request))
    return
  }

  // API GETs: network-first with a runtime fallback for offline use.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => undefined)
          }
          return response
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || new Response(
            JSON.stringify({ error: 'OFFLINE', message: 'No cached data available' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          ))
        )
    )
    return
  }

  // Never cache navigations. Always load current deployment HTML.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request))
    return
  }

  // Only small deployment-independent assets use the cache.
  if (url.pathname.endsWith('.svg') || url.pathname.endsWith('.png') || url.pathname.endsWith('.ico') || url.pathname.endsWith('.woff2')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => undefined)
          }
          return response
        }).catch(() => cached)
        return cached || network
      })
    )
  }
})

self.addEventListener('sync', (event) => {
  if (event.tag === 'fieldops-sync') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'TRIGGER_SYNC' }))
      })
    )
  }
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  const data = event.data.json()
  event.waitUntil(self.registration.showNotification(data.title || 'FieldOps V4', {
    body: data.body || 'إشعار جديد من المنصة',
    icon: '/logo.svg',
    badge: '/logo.svg',
    dir: 'rtl',
    lang: 'ar',
  }))
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()

  if (event.data?.type === 'GET_CACHE_SIZE') {
    caches.open(CACHE_NAME)
      .then((cache) => cache.keys())
      .then((keys) => event.ports[0]?.postMessage({ cacheSize: keys.length }))
  }

  if (event.data?.type === 'TRIGGER_SYNC') {
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'TRIGGER_SYNC' }))
    })
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) return clients[0].focus()
      return self.clients.openWindow('/')
    })
  )
})
