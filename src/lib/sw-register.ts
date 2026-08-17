// FieldOps V4 — Service Worker Registration
// Deployment-safe offline support. The application never blocks on SW startup.

'use client'

let reloadOnControllerChange = false

export async function registerServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  try {
    const hadController = Boolean(navigator.serviceWorker.controller)
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })

    // Always check the network for a new worker after deployment. This call is
    // intentionally best-effort and is never awaited by application bootstrap.
    await registration.update().catch(() => undefined)

    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }

    if (hadController && !reloadOnControllerChange) {
      reloadOnControllerChange = true
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // The new worker is now controlling the page. Reload once so the page
        // and worker are from the same deployment generation.
        window.location.reload()
      }, { once: true })
    }

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing
      if (!newWorker) return

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          newWorker.postMessage({ type: 'SKIP_WAITING' })
        }
      })
    })

    // Request background sync permission; failure must never affect page startup.
    if ('sync' in registration) {
      try {
        await (registration as any).sync.register('fieldops-sync')
      } catch {
        // Background sync not supported.
      }
    }

    console.log('[SW] Service Worker registered and update check completed')
  } catch (error) {
    // Offline/PWA support is optional during bootstrap. Never block the UI on it.
    console.error('[SW] Service Worker registration failed:', error)
  }
}

export async function triggerBackgroundSync(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  try {
    const registration = await navigator.serviceWorker.ready
    if ('sync' in registration) {
      try {
        await (registration as any).sync.register('fieldops-sync')
      } catch {
        navigator.serviceWorker.controller?.postMessage({ type: 'TRIGGER_SYNC' })
      }
    } else {
      navigator.serviceWorker.controller?.postMessage({ type: 'TRIGGER_SYNC' })
    }
  } catch {
    // Background sync is best-effort only.
  }
}

export async function unregisterServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map((registration) => registration.unregister()))
  console.log('[SW] Service Workers unregistered')
}
