// FieldOps V4 — Enhanced Sync Status Bar
// Sprint 5 Phase 2 — Real-time sync queue with progress indicator

'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent } from '@/components/ui/card'
import { Wifi, WifiOff, RefreshCw, UploadCloud, CheckCircle2, AlertCircle, Database, ArrowDownUp, Loader2 } from 'lucide-react'
import { useSyncStatus, useLocalDatabaseStats } from '@/lib/sync-hooks'
import { ProjectCreationDialog } from '@/components/fieldops/ProjectCreationDialog'

interface SyncStatusBarProps {
  orgId: string
  onSync: () => void
  isSyncing: boolean
  onProjectCreated?: () => void | Promise<void>
}

export function SyncStatusBar({ orgId, onSync, isSyncing, onProjectCreated }: SyncStatusBarProps) {
  const syncStatus = useSyncStatus()
  const { stats } = useLocalDatabaseStats()
  const [showDetails, setShowDetails] = useState(false)
  const pendingCount = syncStatus.pendingCount || stats?.syncQueue || 0
  const hasPending = pendingCount > 0

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-gray-100 text-xs">
        <div className="flex items-center gap-1.5">
          {syncStatus.isOnline ? <Wifi className="w-3.5 h-3.5 text-emerald-600" /> : <WifiOff className="w-3.5 h-3.5 text-red-500" />}
          <span className={syncStatus.isOnline ? 'text-emerald-700 font-medium' : 'text-red-600 font-medium'}>{syncStatus.isOnline ? 'متصل' : 'غير متصل'}</span>
        </div>
        <div className="w-px h-3 bg-gray-300" />
        {isSyncing ? <div className="flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin" /><span className="text-blue-700 font-medium">جاري المزامنة...</span></div> : hasPending ? <div className="flex items-center gap-1.5"><UploadCloud className="w-3.5 h-3.5 text-amber-600" /><span className="text-amber-700 font-medium">{pendingCount} معلق</span></div> : <div className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /><span className="text-emerald-700">مزامنة</span></div>}
        {stats && <><div className="w-px h-3 bg-gray-300" /><button onClick={() => setShowDetails(!showDetails)} className="flex items-center gap-1 text-gray-500 hover:text-gray-700"><Database className="w-3 h-3" /><span>{stats.projects}p • {stats.units}u • {stats.boqItems}b</span></button></>}
        <ProjectCreationDialog orgId={orgId} compact onCreated={onProjectCreated} />
        <Button variant="ghost" size="sm" onClick={onSync} disabled={isSyncing || !syncStatus.isOnline} className="h-6 px-2 text-xs ml-auto">{isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownUp className="w-3 h-3" />}</Button>
      </div>
      {showDetails && stats && <Card className="border-gray-200 shadow-sm"><CardContent className="p-3"><div className="grid grid-cols-4 gap-3 text-xs">
        <div><p className="text-gray-500">المشاريع</p><p className="font-bold text-gray-900">{stats.projects}</p></div>
        <div><p className="text-gray-500">الوحدات</p><p className="font-bold text-gray-900">{stats.units}</p></div>
        <div><p className="text-gray-500">بنود الكميات</p><p className="font-bold text-gray-900">{stats.boqItems}</p></div>
        <div><p className="text-gray-500">الملاحظات</p><p className="font-bold text-gray-900">{stats.remarks}</p></div>
        <div><p className="text-gray-500">الصور</p><p className="font-bold text-gray-900">{stats.photos}</p></div>
        <div><p className="text-gray-500">معلق مزامنة</p><p className="font-bold text-amber-600">{stats.pendingSync}</p></div>
        <div><p className="text-gray-500">طابور المزامنة</p><p className="font-bold text-amber-600">{stats.syncQueue}</p></div>
        <div><p className="text-gray-500">سجل التقدم</p><p className="font-bold text-gray-900">{stats.boqProgress}</p></div>
      </div>
      {hasPending && <div className="mt-3"><div className="flex items-center justify-between text-xs text-gray-500 mb-1"><span>تقدم المزامنة</span><span>{pendingCount} عمليات معلقة</span></div><Progress value={0} className="h-1.5" /></div>}
      {syncStatus.errors.length > 0 && <div className="mt-2 space-y-1">{syncStatus.errors.map((err, i) => <div key={i} className="flex items-center gap-1 text-xs text-red-600"><AlertCircle className="w-3 h-3" />{err}</div>)}</div>}
      </CardContent></Card>}
    </div>
  )
}
