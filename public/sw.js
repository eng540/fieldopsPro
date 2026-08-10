// FieldOps V4 — Service Worker
// Sprint 5 Phase 3 — Offline-First Caching & Background Sync

const CACHE_NAME = 'fieldops-v4-v1'
const STATIC_ASSETS = [
  '/',
  '/logo.svg',
]

// Install — Pre-cache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS)
    })
  )
  self.skipWaiting()
})

// Activate — Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    })
  )
  self.clients.claim()
})

// Fetch — Network-first for API, Cache-first for static
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== 'GET') return

  // API calls — Network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone and cache the successful response
          if (response.ok) {
            const responseClone = response.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone)
            })
          }
          return response
        })
        .catch(() => {
          // Network failed — serve from cache
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse
            }
            return new Response(
              JSON.stringify({ error: 'OFFLINE', message: 'No cached data available' }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              }
            )
          })
        })
    )
    return
  }

  // Static assets — Cache-first
  if (
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.includes('/_next/static/')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached, but also update cache in background
          fetch(request)
            .then((response) => {
              if (response.ok) {
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(request, response)
                })
              }
            })
            .catch(() => {})
          return cachedResponse
        }

        return fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone)
            })
          }
          return response
        })
      })
    )
    return
  }

  // Navigation requests — Network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone)
          })
          return response
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse || caches.match('/')
          })
        })
    )
    return
  }
})

// Background Sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'fieldops-sync') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_SYNC' })
        })
      })
    )
  }
})

// Push Notifications
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json()
    const title = data.title || 'FieldOps V4'
    const options = {
      body: data.body || 'إشعار جديد من المنصة',
      icon: '/logo.svg',
      badge: '/logo.svg',
      dir: 'rtl' as const,
      lang: 'ar',
    }
    event.waitUntil(self.registration.showNotification(title, options))
  }
})

// Message handling
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }

  if (event.data && event.data.type === 'GET_CACHE_SIZE') {
    caches.open(CACHE_NAME).then((cache) => {
      return cache.keys()
    }).then((keys) => {
      event.ports[0].postMessage({ cacheSize: keys.length })
    })
  }

  if (event.data && event.data.type === 'TRIGGER_SYNC') {
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'TRIGGER_SYNC' })
      })
    })
  }
})

// Notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) {
        clients[0].focus()
      } else {
        self.clients.openWindow('/')
      }
    })
  )
})
