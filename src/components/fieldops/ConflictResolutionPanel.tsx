'use client'

import React, { useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertTriangle,
  Check,
  X,
  RefreshCw,
  Clock,
  Server,
  HardDrive,
  ArrowRight,
} from 'lucide-react'
import type { SyncQueueItem } from '@/lib/offline-db'
import { updateSyncQueueItem, db } from '@/lib/offline-db'
import { useToast } from '@/hooks/use-toast'

// ============================================================
// Arabic Translation Maps
// ============================================================

const ENTITY_TYPE_AR: Record<SyncQueueItem['entityType'], string> = {
  project: 'مشروع',
  unit: 'وحدة',
  boqProgress: 'تقدم الكميات',
  remark: 'ملاحظة',
  photo: 'صورة',
  user: 'مستخدم',
  dictionary: 'قاموس',
}

const OPERATION_TYPE_AR: Record<SyncQueueItem['operationType'], string> = {
  CREATE: 'إنشاء',
  UPDATE: 'تحديث',
  DELETE: 'حذف',
  BULK_PROGRESS: 'تحديث جماعي',
}

const STATUS_AR: Record<string, string> = {
  CONFLICT: 'تعارض',
  FAILED: 'فشل',
  PENDING: 'معلق',
  IN_PROGRESS: 'قيد التنفيذ',
  COMPLETED: 'مكتمل',
}

// FastAPI Sync Conflict Types (from openapi.yaml)
const CONFLICT_TYPE_AR: Record<string, string> = {
  MONOTONIC_VIOLATION: 'انتهاك سياسة الإنجاز الأحادي',
  TIMESTAMP_SKEW: 'انحراف ساعة الجهاز',
  CONCURRENT_EDIT: 'تعديل متزامن',
  POLICY_BLOCK: 'حظر حوكمة',
}

const CONFLICT_TYPE_ICON: Record<string, string> = {
  MONOTONIC_VIOLATION: '⚠️',
  TIMESTAMP_SKEW: '🕐',
  CONCURRENT_EDIT: '🔄',
  POLICY_BLOCK: '🛡️',
}

// ============================================================
// Props Interface
// ============================================================

interface ConflictResolutionPanelProps {
  conflicts: SyncQueueItem[]
  /** Server data from 207 Multi-Status response, keyed by operationUuid */
  serverDataMap?: Record<string, Record<string, unknown>>
  onResolve: (id: number, resolution: 'KEEP_LOCAL' | 'KEEP_SERVER' | 'MERGE') => void
  onRefresh: () => void
}

// ============================================================
// Helper: Format timestamp to Arabic locale
// ============================================================

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ============================================================
// Helper: Parse JSON safely
// ============================================================

function safeParseJson(jsonStr: string): Record<string, unknown> | null {
  try {
    return JSON.parse(jsonStr) as Record<string, unknown>
  } catch {
    return null
  }
}

// ============================================================
// Helper: Render a key-value diff row
// ============================================================

function DiffRow({
  label,
  localValue,
  serverValue,
}: {
  label: string
  localValue: unknown
  serverValue: unknown
}) {
  const localStr = localValue === null || localValue === undefined ? '—' : String(localValue)
  const serverStr = serverValue === null || serverValue === undefined ? '—' : String(serverValue)
  const isDifferent = localStr !== serverStr

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-start text-sm">
      <div
        className={`rounded-md px-3 py-2 ${
          isDifferent
            ? 'bg-amber-50 border border-amber-200 text-amber-900'
            : 'bg-gray-50 text-gray-700'
        }`}
      >
        <span className="font-mono text-xs break-all">{localStr}</span>
      </div>
      <div className="flex items-center justify-center text-gray-400 self-center">
        <ArrowRight className="w-4 h-4" />
      </div>
      <div
        className={`rounded-md px-3 py-2 ${
          isDifferent
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
            : 'bg-gray-50 text-gray-700'
        }`}
      >
        <span className="font-mono text-xs break-all">{serverStr}</span>
      </div>
    </div>
  )
}

// ============================================================
// Merge Dialog Sub-component
// ============================================================

function MergeDialog({
  conflict,
  open,
  onOpenChange,
  onMerge,
  serverData,
}: {
  conflict: SyncQueueItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onMerge: () => void
  /** Server data from 207 Multi-Status response for this specific conflict */
  serverData?: Record<string, unknown> | null
}) {
  const localData = safeParseJson(conflict.payload)
  // Use actual server data from 207 Multi-Status response
  // Fallback to parsing lastError if no server data provided
  const serverDataInner = serverData || null

  const allKeys = Array.from(
    new Set([
      ...(localData ? Object.keys(localData) : []),
      ...(serverDataInner ? Object.keys(serverDataInner) : []),
    ])
  ).sort()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl dir-rtl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            مقارنة البيانات — دمج التعارض
          </DialogTitle>
          <DialogDescription className="text-right">
            قارن بين البيانات المحلية وبيانات الخادم لاختيار القيم الصحيحة. سيتم دمج
            البيانات المحلية فوق بيانات الخادم.
          </DialogDescription>
        </DialogHeader>

        <Separator />

        {/* Column headers */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center text-sm font-semibold">
          <div className="flex items-center gap-2 text-amber-700">
            <HardDrive className="w-4 h-4" />
            البيانات المحلية
          </div>
          <div />
          <div className="flex items-center gap-2 text-emerald-700">
            <Server className="w-4 h-4" />
            بيانات الخادم
          </div>
        </div>

        <Separator />

        {/* Diff content */}
        <ScrollArea className="max-h-96">
          <div className="space-y-2">
            {localData ? (
              allKeys.map((key) => (
                <div key={key}>
                  <p className="text-xs font-medium text-gray-500 mb-1">{key}</p>
                  <DiffRow
                    label={key}
                    localValue={localData[key]}
                    serverValue={serverDataInner?.[key]}
                  />
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <p>تعذر تحليل البيانات المحلية</p>
                <pre className="mt-2 text-xs bg-gray-100 rounded p-3 overflow-auto max-h-40 text-left dir-ltr">
                  {conflict.payload}
                </pre>
              </div>
            )}
          </div>
        </ScrollArea>

        <Separator />

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="gap-2"
          >
            <X className="w-4 h-4" />
            إلغاء
          </Button>
          <Button
            onClick={onMerge}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
          >
            <Check className="w-4 h-4" />
            تأكيد الدمج
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================
// Conflict Card Sub-component
// ============================================================

function ConflictCard({
  conflict,
  onResolve,
  serverData,
}: {
  conflict: SyncQueueItem
  onResolve: (id: number, resolution: 'KEEP_LOCAL' | 'KEEP_SERVER' | 'MERGE') => void
  /** Server data from 207 Multi-Status response for this conflict */
  serverData?: Record<string, unknown> | null
}) {
  const { toast } = useToast()
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [isResolving, setIsResolving] = useState(false)

  const handleResolve = useCallback(
    async (resolution: 'KEEP_LOCAL' | 'KEEP_SERVER' | 'MERGE') => {
      if (conflict.id === undefined) return
      setIsResolving(true)
      try {
        if (resolution === 'KEEP_LOCAL') {
          await updateSyncQueueItem(conflict.id, {
            status: 'PENDING',
            retryCount: 0,
            lastError: null,
          })
        } else if (resolution === 'KEEP_SERVER') {
          await updateSyncQueueItem(conflict.id, {
            status: 'COMPLETED',
            processedAt: Date.now(),
          })
        } else {
          // MERGE: reset to pending so the merged payload gets re-synced
          await updateSyncQueueItem(conflict.id, {
            status: 'PENDING',
            retryCount: 0,
            lastError: null,
          })
        }
        onResolve(conflict.id, resolution)
        toast({
          title: 'تم حل التعارض',
          description:
            resolution === 'KEEP_LOCAL'
              ? 'تم الاحتفاظ بالبيانات المحلية'
              : resolution === 'KEEP_SERVER'
                ? 'تم الاحتفاظ ببيانات الخادم'
                : 'تم دمج البيانات بنجاح',
        })
      } catch (err) {
        toast({
          title: 'خطأ',
          description: 'حدث خطأ أثناء حل التعارض',
          variant: 'destructive',
        })
      } finally {
        setIsResolving(false)
        setMergeDialogOpen(false)
      }
    },
    [conflict.id, onResolve, toast]
  )

  const statusBadgeVariant =
    conflict.status === 'CONFLICT'
      ? 'destructive'
      : conflict.status === 'FAILED'
        ? 'destructive'
        : 'secondary'

  const statusColor =
    conflict.status === 'CONFLICT'
      ? 'bg-red-100 text-red-800 border-red-200'
      : conflict.status === 'FAILED'
        ? 'bg-red-100 text-red-800 border-red-200'
        : 'bg-amber-100 text-amber-800 border-amber-200'

  const isRetryExhausted = conflict.retryCount >= conflict.maxRetries

  return (
    <>
      <Card className="border-amber-200 bg-white shadow-sm overflow-hidden" dir="rtl">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-100">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <CardTitle className="text-base text-gray-900">
                  {ENTITY_TYPE_AR[conflict.entityType]} —{' '}
                  {OPERATION_TYPE_AR[conflict.operationType]}
                </CardTitle>
                <div className="flex items-center gap-2 mt-1">
                  <Badge
                    variant={statusBadgeVariant}
                    className={statusColor}
                  >
                    {STATUS_AR[conflict.status] ?? conflict.status}
                  </Badge>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTimestamp(conflict.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Error message */}
          {conflict.lastError && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="break-words">{conflict.lastError}</p>
            </div>
          )}

          {/* Retry count */}
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              <span>
                محاولات الإعادة:{' '}
                <span
                  className={
                    isRetryExhausted
                      ? 'text-red-600 font-semibold'
                      : 'font-medium'
                  }
                >
                  {conflict.retryCount} / {conflict.maxRetries}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-amber-600" />
              <span>{ENTITY_TYPE_AR[conflict.entityType]}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-emerald-600" />
              <span>{OPERATION_TYPE_AR[conflict.operationType]}</span>
            </div>
          </div>

          <Separator />

          {/* Resolution actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isResolving}
              onClick={() => handleResolve('KEEP_LOCAL')}
              className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
            >
              <HardDrive className="w-3.5 h-3.5" />
              إبقاء المحلي
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={isResolving}
              onClick={() => handleResolve('KEEP_SERVER')}
              className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
            >
              <Server className="w-3.5 h-3.5" />
              إبقاء الخادم
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={isResolving}
              onClick={() => setMergeDialogOpen(true)}
              className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              دمج
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Merge Dialog */}
      <MergeDialog
        conflict={conflict}
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        onMerge={() => handleResolve('MERGE')}
        serverData={serverData}
      />
    </>
  )
}

// ============================================================
// Empty State
// ============================================================

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6" dir="rtl">
      <div className="flex items-center justify-center w-20 h-20 rounded-full bg-emerald-50 mb-6">
        <Check className="w-10 h-10 text-emerald-600" />
      </div>
      <h3 className="text-xl font-semibold text-gray-900 mb-2">
        لا توجد تعارضات — جميع البيانات متزامنة
      </h3>
      <p className="text-sm text-gray-500 mb-6 text-center max-w-md">
        جميع التغييرات المحلية متوافقة مع بيانات الخادم. يمكنك تحديث الحالة يدوياً
        للتحقق من وجود تعارضات جديدة.
      </p>
      <Button
        variant="outline"
        onClick={onRefresh}
        className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
      >
        <RefreshCw className="w-4 h-4" />
        تحديث
      </Button>
    </div>
  )
}

// ============================================================
// Main Component
// ============================================================

export function ConflictResolutionPanel({
  conflicts,
  serverDataMap,
  onResolve,
  onRefresh,
}: ConflictResolutionPanelProps) {
  const conflictCount = conflicts.length

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-100">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">حل التعارضات</h2>
            <p className="text-sm text-gray-500">
              {conflictCount > 0
                ? `${conflictCount} تعارض بحاجة إلى حل`
                : 'لا توجد تعارضات حالياً'}
            </p>
          </div>
        </div>

        {conflictCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث
          </Button>
        )}
      </div>

      {/* Content */}
      {conflictCount === 0 ? (
        <EmptyState onRefresh={onRefresh} />
      ) : (
        <ScrollArea className="max-h-[calc(100vh-220px)]">
          <div className="space-y-3">
            {conflicts.map((conflict) => (
              <ConflictCard
                key={conflict.id ?? conflict.operationUuid}
                conflict={conflict}
                onResolve={onResolve}
                serverData={serverDataMap?.[conflict.operationUuid]}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
