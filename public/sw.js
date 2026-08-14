// FieldOps V4 — Service Worker
// Deployment-safe offline support: never pin a previous Next.js build.

const CACHE_NAME = 'fieldops-v4-v2'
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
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET') return

  // The service-worker script itself must always be fetched from the network so
  // an older worker cannot pin itself forever.
  if (url.pathname === '/sw.js') return

  // Next.js build assets are immutable and build-specific. Serving an old
  // chunk after a deployment can produce the production "page couldn't load"
  // / ChunkLoadError failure. Always prefer the network and only fall back to
  // a cached asset when the network is unavailable.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match(request))
    )
    return
  }

  // API calls — network-first, cache only successful GET responses.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone))
          }
          return response
        })
        .catch(() =>
          caches.match(request).then((cachedResponse) =>
            cachedResponse || new Response(
              JSON.stringify({ error: 'OFFLINE', message: 'No cached data available' }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            )
          )
        )
    )
    return
  }

  // Application navigation — always prefer the current deployment. A cached
  // HTML shell is used only when the network is unavailable.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone))
          }
          return response
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    )
    return
  }

  // Small non-Next static assets — stale-while-revalidate is safe here.
  if (
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const network = fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone))
          }
          return response
        }).catch(() => cachedResponse)
        return cachedResponse || network
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
  const title = data.title || 'FieldOps V4'
  const options = {
    body: data.body || 'إشعار جديد من المنصة',
    icon: '/logo.svg',
    badge: '/logo.svg',
    dir: 'rtl',
    lang: 'ar',
  }
  event.waitUntil(self.registration.showNotification(title, options))
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
