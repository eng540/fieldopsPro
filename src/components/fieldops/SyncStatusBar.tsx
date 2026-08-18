// FieldOps V4 — Enhanced Sync Status Bar
// Sprint 5 Phase 2 — Real-time sync queue with progress indicator

'use client'

import React from 'react'
import { Button } from '@/components/ui/button'
import { Wifi, WifiOff, RefreshCw, UploadCloud, CheckCircle2, AlertCircle, ArrowDownUp, Loader2 } from 'lucide-react'
import { useSyncStatus } from '@/lib/sync-hooks'

interface SyncStatusBarProps { orgId: string; onSync: () => void; isSyncing: boolean }

export function SyncStatusBar({ orgId: _orgId, onSync, isSyncing }: SyncStatusBarProps) {
  const syncStatus = useSyncStatus()
  const pendingCount = syncStatus.pendingCount || 0
  const hasPending = pendingCount > 0

  return <div className="space-y-1">
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-gray-100 text-xs" aria-live="polite">
      <div className="flex items-center gap-1.5">
        {syncStatus.isOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-600" /> : <WifiOff className="w-3.5 h-3.5 text-red-500" />}
        <span className={syncStatus.isOnline ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>{syncStatus.isOnline ? 'متصل' : 'غير متصل'}</span>
      </div>
      <div className="w-px h-3 bg-gray-300" />
      {isSyncing ? <div className="flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin" /><span className="text-blue-700 font-medium">جاري المزامنة...</span></div> : hasPending ? <div className="flex items-center gap-1.5"><UploadCloud className="w-3.5 h-3.5 text-amber-600" /><span className="text-amber-700 font-medium">{pendingCount} معلق</span></div> : <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /><span className="text-emerald-700">مزامنة</span></div>}
      <Button variant="ghost" size="sm" onClick={onSync} disabled={isSyncing || !syncStatus.isOnline} className="h-6 px-2 text-xs ml-auto">{isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownUp className="w-3 h-3" />}</Button>
    </div>
    {syncStatus.errors.length > 0 && <div className="mt-2 space-y-1 rounded-lg border border-red-100 bg-red-50 px-3 py-2">{syncStatus.errors.map((err, i) => <div key={i} className="flex items-center gap-1 text-xs text-red-600"><AlertCircle className="w-3 h-3" />{err}</div>)}</div>}
  </div>
}
