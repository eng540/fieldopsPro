// FieldOps V4 — Service Worker Registration
// Sprint 5 Phase 3 — Offline-First Support

'use client'

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    })

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing
      if (!newWorker) return

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New content available — could show a notification
          console.log('[SW] New content available, refresh to update')
        }
      })
    })

    // Request background sync permission
    if ('sync' in registration) {
      try {
        await (registration as any).sync.register('fieldops-sync')
      } catch {
        // Background sync not supported
      }
    }

    console.log('[SW] Service Worker registered successfully')
  } catch (error) {
    console.error('[SW] Service Worker registration failed:', error)
  }
}

export async function triggerBackgroundSync(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  const registration = await navigator.serviceWorker.ready
  if ('sync' in registration) {
    try {
      await (registration as any).sync.register('fieldops-sync')
    } catch {
      // Fallback: post message to SW
      navigator.serviceWorker.controller?.postMessage({
        type: 'TRIGGER_SYNC',
      })
    }
  } else {
    // Fallback: post message to SW
    navigator.serviceWorker.controller?.postMessage({
      type: 'TRIGGER_SYNC',
    })
  }
}

export async function unregisterServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  const registration = await navigator.serviceWorker.ready
  await registration.unregister()
  console.log('[SW] Service Worker unregistered')
}
