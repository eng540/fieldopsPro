import { create } from 'zustand'
import { pushOperations, pullFromServer, getReachability, startReachabilityMonitoring } from '@/lib/sync'
import { db } from '@/lib/db'

interface SyncConflict {
  operationUuid: string
  conflictType: string
  serverValue: Record<string, unknown>
  clientValue: Record<string, unknown>
  hint: string
}

interface SyncState {
  isOnline: boolean
  isSyncing: boolean
  pendingCount: number
  lastSyncVersion: string | null
  lastSyncAt: string | null
  conflicts: SyncConflict[]
  checkOnline: () => void
  startSync: () => Promise<void>
  loadPendingCount: () => Promise<void>
  resolveConflict: (operationUuid: string, resolution: 'SERVER' | 'CLIENT') => Promise<void>
  dismissConflict: (operationUuid: string) => void
}

export const useSyncStore = create<SyncState>((set, get) => ({
  isOnline: navigator.onLine,
  isSyncing: false,
  pendingCount: 0,
  lastSyncVersion: localStorage.getItem('lastSyncVersion'),
  lastSyncAt: localStorage.getItem('lastSyncAt'),
  conflicts: [],

  checkOnline: () => set({ isOnline: getReachability() }),

  loadPendingCount: async () => {
    const count = await db.syncQueue.count()
    set({ pendingCount: count })
  },

  startSync: async () => {
    if (get().isSyncing) return
    set({ isSyncing: true })
    try {
      // 1. Push pending operations
      const pushResult = await pushOperations()
      const newConflicts: SyncConflict[] = (pushResult?.conflicts ?? []).map((c: any) => ({
        operationUuid: c.operation_uuid,
        conflictType: c.conflict_type,
        serverValue: c.server_value,
        clientValue: c.client_value,
        hint: c.resolution_hint,
      }))

      // 2. Pull latest from server
      const lastSyncVersion = get().lastSyncVersion
      const pullResult = await pullFromServer(lastSyncVersion)
      if (pullResult?.syncVersion) {
        localStorage.setItem('lastSyncVersion', pullResult.syncVersion)
        localStorage.setItem('lastSyncAt', new Date().toISOString())
        set({
          lastSyncVersion: pullResult.syncVersion,
          lastSyncAt: new Date().toISOString(),
        })
      }

      const pending = await db.syncQueue.count()
      set({ pendingCount: pending, conflicts: newConflicts })
    } catch (err) {
      console.error('Sync failed:', err)
    } finally {
      set({ isSyncing: false })
    }
  },

  resolveConflict: async (operationUuid, resolution) => {
    if (resolution === 'CLIENT') {
      // Re-queue the operation — will be retried next sync
      const op = await db.syncQueue.get(operationUuid)
      if (op) {
        await db.syncQueue.put({ ...op, retryCount: 0 })
      }
    }
    // Either way, remove from conflict list
    set(state => ({
      conflicts: state.conflicts.filter(c => c.operationUuid !== operationUuid)
    }))
  },

  dismissConflict: (operationUuid) => {
    set(state => ({
      conflicts: state.conflicts.filter(c => c.operationUuid !== operationUuid)
    }))
  },
}))

// Start monitoring reachability on module load
startReachabilityMonitoring()
window.addEventListener('online', () => useSyncStore.getState().checkOnline())
window.addEventListener('offline', () => useSyncStore.getState().checkOnline())