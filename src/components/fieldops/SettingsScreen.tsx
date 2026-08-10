// FieldOps V4 — Settings & Offline Management Screen
// Sprint 5 Phase 2 — Database stats, cache management, sync controls

'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Database, Trash2, Download, Upload, RefreshCw, HardDrive,
  AlertCircle, CheckCircle2, Loader2, WifiOff, Wifi, Shield,
  FileText, Clock, Server
} from 'lucide-react'
import { useLocalDatabaseStats, useSyncStatus, useSyncEngine } from '@/lib/sync-hooks'
import { clearLocalDatabase, getLocalDatabaseStats } from '@/lib/offline-db'
import { useToast } from '@/hooks/use-toast'

interface SettingsScreenProps {
  orgId: string
}

export function SettingsScreen({ orgId }: SettingsScreenProps) {
  const { stats, refresh: refreshStats } = useLocalDatabaseStats()
  const syncStatus = useSyncStatus()
  const { syncAll, pushPending, syncing, lastSyncResult } = useSyncEngine(orgId)
  const [clearing, setClearing] = useState(false)
  const { toast } = useToast()

  const handleClearCache = async () => {
    setClearing(true)
    try {
      await clearLocalDatabase()
      await refreshStats()
      toast({ title: 'تم مسح البيانات المحلية', description: 'سيتم إعادة تحميل البيانات عند المزامنة' })
    } catch (err) {
      toast({ title: 'خطأ', description: 'فشل مسح البيانات المحلية', variant: 'destructive' })
    } finally {
      setClearing(false)
    }
  }

  const handleFullSync = async () => {
    const result = await syncAll()
    if (result) {
      toast({
        title: result.success ? 'تمت المزامنة بنجاح' : 'مزامنة جزئية',
        description: `مشاريع: ${result.synced.projects} | مستخدمين: ${result.synced.users} | ملاحظات: ${result.synced.remarks}`,
        variant: result.success ? 'default' : 'destructive',
      })
    }
    await refreshStats()
  }

  const handlePushPending = async () => {
    const result = await pushPending()
    if (result) {
      toast({
        title: 'تم الدفع',
        description: `تم معالجة: ${result.processed} | فشل: ${result.failed} | متبقي: ${result.remaining}`,
      })
    }
    await refreshStats()
  }

  const totalLocalRecords = stats ? stats.projects + stats.units + stats.boqItems + stats.boqProgress + stats.remarks + stats.photos + stats.users + stats.auditLogs + stats.dictionaries : 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">الإعدادات والبيانات المحلية</h2>
        <p className="text-sm text-gray-500 mt-1">إدارة قاعدة البيانات المحلية والمزامنة</p>
      </div>

      {/* Connection Status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            {syncStatus.isOnline ? <Wifi className="w-5 h-5 text-emerald-600" /> : <WifiOff className="w-5 h-5 text-red-500" />}
            حالة الاتصال
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500">الاتصال</p>
              <p className={`text-sm font-bold ${syncStatus.isOnline ? 'text-emerald-600' : 'text-red-600'}`}>
                {syncStatus.isOnline ? 'متصل' : 'غير متصل'}
              </p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500">المزامنة</p>
              <p className={`text-sm font-bold ${syncing ? 'text-blue-600' : 'text-gray-600'}`}>
                {syncing ? 'جارية...' : 'متوقفة'}
              </p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500">معلق</p>
              <p className="text-sm font-bold text-amber-600">{syncStatus.pendingCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Local Database Stats */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-gray-600" />
              قاعدة البيانات المحلية (IndexedDB)
            </CardTitle>
            <Badge variant="outline" className="text-xs">{totalLocalRecords} سجل</Badge>
          </div>
          <CardDescription>البيانات المخزنة محلياً للعمل دون اتصال</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {[
              { label: 'المشاريع', value: stats?.projects || 0, icon: Server, color: 'text-emerald-600' },
              { label: 'الوحدات', value: stats?.units || 0, icon: Database, color: 'text-blue-600' },
              { label: 'بنود الكميات', value: stats?.boqItems || 0, icon: FileText, color: 'text-purple-600' },
              { label: 'سجل التقدم', value: stats?.boqProgress || 0, icon: Clock, color: 'text-amber-600' },
              { label: 'الملاحظات', value: stats?.remarks || 0, icon: Shield, color: 'text-red-600' },
              { label: 'الصور', value: stats?.photos || 0, icon: Database, color: 'text-cyan-600' },
              { label: 'المستخدمين', value: stats?.users || 0, icon: Shield, color: 'text-indigo-600' },
              { label: 'سجل التدقيق', value: stats?.auditLogs || 0, icon: Clock, color: 'text-gray-600' },
              { label: 'القواميس', value: stats?.dictionaries || 0, icon: FileText, color: 'text-teal-600' },
              { label: 'معلق مزامنة', value: stats?.pendingSync || 0, icon: AlertCircle, color: 'text-amber-600' },
            ].map(item => (
              <div key={item.label} className="p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <item.icon className={`w-4 h-4 ${item.color}`} />
                  <span className="text-lg font-bold text-gray-900">{item.value}</span>
                </div>
                <p className="text-xs text-gray-500">{item.label}</p>
              </div>
            ))}
          </div>

          {/* Sync Queue */}
          {stats && stats.syncQueue > 0 && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-amber-800">طابور المزامنة</span>
                <span className="text-sm font-bold text-amber-800">{stats.syncQueue} عملية</span>
              </div>
              <Progress value={0} className="h-1.5" />
              <p className="text-xs text-amber-600 mt-1">العمليات ستُعالج عند الاتصال أو المزامنة اليدوية</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">إجراءات المزامنة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Button
              onClick={handleFullSync}
              disabled={syncing || !syncStatus.isOnline}
              className="bg-emerald-600 hover:bg-emerald-700 h-auto py-3"
            >
              {syncing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Download className="w-4 h-4 ml-2" />}
              <div className="text-right">
                <div className="text-sm font-medium">مزامنة كاملة</div>
                <div className="text-xs opacity-80">سحب من الخادم + دفع المعلق</div>
              </div>
            </Button>

            <Button
              variant="outline"
              onClick={handlePushPending}
              disabled={syncing || !syncStatus.isOnline || (stats?.syncQueue || 0) === 0}
              className="h-auto py-3"
            >
              <Upload className="w-4 h-4 ml-2" />
              <div className="text-right">
                <div className="text-sm font-medium">دفع المعلق</div>
                <div className="text-xs text-gray-500">إرسال التغييرات المحلية</div>
              </div>
            </Button>

            <Button
              variant="outline"
              onClick={handleClearCache}
              disabled={clearing}
              className="h-auto py-3 border-red-200 text-red-600 hover:bg-red-50"
            >
              {clearing ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Trash2 className="w-4 h-4 ml-2" />}
              <div className="text-right">
                <div className="text-sm font-medium">مسح البيانات المحلية</div>
                <div className="text-xs text-red-400">حذف جميع البيانات المخزنة محلياً</div>
              </div>
            </Button>
          </div>

          {/* Last Sync Result */}
          {lastSyncResult && (
            <Alert className={lastSyncResult.success ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}>
              {lastSyncResult.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <AlertCircle className="w-4 h-4 text-amber-600" />}
              <AlertDescription className="text-xs">
                <div className="flex items-center gap-3">
                  <span>مشاريع: {lastSyncResult.synced.projects}</span>
                  <span>مستخدمين: {lastSyncResult.synced.users}</span>
                  <span>ملاحظات: {lastSyncResult.synced.remarks}</span>
                  <span>تدقيق: {lastSyncResult.synced.auditLogs}</span>
                  <span>قواميس: {lastSyncResult.synced.dictionaries}</span>
                </div>
                {lastSyncResult.errors.length > 0 && (
                  <div className="mt-1 text-red-600">{lastSyncResult.errors.join(', ')}</div>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Architecture Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">معلومات البنية</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-xs text-gray-600">
            <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
              <span>محرك قاعدة البيانات المحلية</span>
              <span className="font-mono font-medium">Dexie.js (IndexedDB)</span>
            </div>
            <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
              <span>استراتيجية المزامنة</span>
              <span className="font-mono font-medium">Online-First, Offline-Fallback</span>
            </div>
            <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
              <span>معالجة التعارضات</span>
              <span className="font-mono font-medium">Server-Wins (ADR-002)</span>
            </div>
            <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
              <span>سياسة الإنجاز</span>
              <span className="font-mono font-medium">Monotonic (ADR-003)</span>
            </div>
            <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
              <span>مزامنة تلقائية</span>
              <span className="font-mono font-medium">كل 5 دقائق</span>
            </div>
            <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
              <span>ضغط الصور</span>
              <span className="font-mono font-medium">JPEG 70% - Max 1200px</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
