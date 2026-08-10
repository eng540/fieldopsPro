// FieldOps V4 — React Hooks for Offline-First Sync
// Sprint 5 Phase 2

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { isOnline, onOnlineStatusChange, onSyncStatusChange, fullDataSync, processSyncQueue, type SyncStatus } from './api-client'
import { getPendingSyncCount, getLocalDatabaseStats } from './offline-db'

// ============================================================
// useOnlineStatus Hook
// ============================================================

export function useOnlineStatus() {
  const [online, setOnline] = useState(isOnline())

  useEffect(() => {
    return onOnlineStatusChange((status) => {
      setOnline(status)
    })
  }, [])

  return online
}

// ============================================================
// useSyncStatus Hook
// ============================================================

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: isOnline(),
    isSyncing: false,
    pendingCount: 0,
    lastSyncAt: null,
    errors: [],
  })

  useEffect(() => {
    // Initial count
    getPendingSyncCount().then(count => {
      setStatus(prev => ({ ...prev, pendingCount: count }))
    })

    return onSyncStatusChange((newStatus) => {
      setStatus(newStatus)
    })
  }, [])

  return status
}

// ============================================================
// useSyncEngine Hook
// ============================================================

export function useSyncEngine(orgId: string) {
  const [syncing, setSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<{
    success: boolean
    synced: { projects: number; users: number; remarks: number; auditLogs: number; dictionaries: number }
    errors: string[]
  } | null>(null)

  const syncAll = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const result = await fullDataSync(orgId)
      setLastSyncResult(result)
      return result
    } finally {
      setSyncing(false)
    }
  }, [orgId, syncing])

  const pushPending = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      return await processSyncQueue()
    } finally {
      setSyncing(false)
    }
  }, [syncing])

  // Auto-sync every 5 minutes when online
  useEffect(() => {
    const interval = setInterval(() => {
      if (isOnline()) {
        pushPending()
      }
    }, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [pushPending])

  return { syncAll, pushPending, syncing, lastSyncResult }
}

// ============================================================
// useLocalDatabaseStats Hook
// ============================================================

export function useLocalDatabaseStats() {
  const [stats, setStats] = useState<{
    projects: number; units: number; boqItems: number;
    boqProgress: number; remarks: number; photos: number;
    pendingSync: number; syncQueue: number;
  } | null>(null)

  const refresh = useCallback(async () => {
    const s = await getLocalDatabaseStats()
    setStats(s)
  }, [])

  useEffect(() => {
    // Initial load
    getLocalDatabaseStats().then(setStats)
    const interval = setInterval(async () => {
      const s = await getLocalDatabaseStats()
      setStats(s)
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  return { stats, refresh }
}

// ============================================================
// useAutoSync Hook — Syncs on mount and on online event
// ============================================================

export function useAutoSync(orgId: string, enabled: boolean = true) {
  const syncEngine = useSyncEngine(orgId)
  const hasSyncedRef = useRef(false)

  useEffect(() => {
    if (!enabled || !orgId || hasSyncedRef.current) return

    // Initial sync on mount
    syncEngine.syncAll().then(() => {
      hasSyncedRef.current = true
    })
  }, [orgId, enabled])

  // Sync when coming back online
  useEffect(() => {
    return onOnlineStatusChange((online) => {
      if (online && orgId) {
        syncEngine.pushPending()
      }
    })
  }, [orgId])

  return syncEngine
}
