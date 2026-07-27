import { useEffect } from 'react'
import { useSyncStore } from '@/stores/syncStore'
import { Wifi, WifiOff, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react'

export function SyncStatusBar() {
  const { isOnline, isSyncing, pendingCount, lastSyncAt, conflicts, startSync, loadPendingCount } = useSyncStore()

  useEffect(() => {
    loadPendingCount()
    const interval = setInterval(() => {
      loadPendingCount()
      if (isOnline && pendingCount > 0) startSync()
    }, 30000)
    return () => clearInterval(interval)
  }, [isOnline, pendingCount])

  const lastSyncLabel = lastSyncAt
    ? new Date(lastSyncAt).toLocaleTimeString()
    : 'Never'

  return (
    <div className={`flex items-center gap-3 px-4 py-2 text-xs font-medium border-b ${
      isOnline ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'
    }`}>
      {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
      <span>{isOnline ? 'Online' : 'Offline'}</span>

      {pendingCount > 0 && (
        <span className="bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">
          {pendingCount} pending
        </span>
      )}

      {conflicts.length > 0 && (
        <span className="bg-red-200 text-red-900 px-2 py-0.5 rounded-full flex items-center gap-1">
          <AlertTriangle size={11} /> {conflicts.length} conflict{conflicts.length > 1 ? 's' : ''}
        </span>
      )}

      {pendingCount === 0 && conflicts.length === 0 && isOnline && (
        <span className="flex items-center gap-1 text-emerald-700">
          <CheckCircle size={12} /> Synced {lastSyncLabel}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        {isOnline && pendingCount > 0 && (
          <button
            onClick={() => startSync()}
            disabled={isSyncing}
            className="flex items-center gap-1 px-2 py-0.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
          >
            <RefreshCw size={11} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
      </div>
    </div>
  )
}
