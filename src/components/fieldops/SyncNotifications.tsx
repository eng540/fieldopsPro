// FieldOps V4 — Sync Notifications Toast System
// Sprint 5 Phase 2 — Arabic RTL toast notifications for sync events

'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Wifi,
  WifiOff,
  X,
  Loader2,
} from 'lucide-react'
import { useSyncStatus, useOnlineStatus } from '@/lib/sync-hooks'
import { isOnline } from '@/lib/api-client'

// ============================================================
// Types
// ============================================================

type NotificationType =
  | 'online'
  | 'offline'
  | 'sync-started'
  | 'sync-completed'
  | 'sync-failed'
  | 'pending-items'
  | 'conflict-detected'

interface SyncNotification {
  id: string
  type: NotificationType
  message: string
  timestamp: number
  autoDismiss: number // milliseconds until auto-dismiss
}

interface SyncNotificationsProps {
  orgId: string
}

// ============================================================
// Config
// ============================================================

const NOTIFICATION_CONFIG: Record<
  NotificationType,
  { bg: string; border: string; text: string; iconColor: string; duration: number }
> = {
  online: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-300',
    text: 'text-emerald-800',
    iconColor: 'text-emerald-600',
    duration: 5000,
  },
  offline: {
    bg: 'bg-red-50',
    border: 'border-red-300',
    text: 'text-red-800',
    iconColor: 'text-red-500',
    duration: 8000,
  },
  'sync-started': {
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    text: 'text-blue-800',
    iconColor: 'text-blue-600',
    duration: 5000,
  },
  'sync-completed': {
    bg: 'bg-emerald-50',
    border: 'border-emerald-300',
    text: 'text-emerald-800',
    iconColor: 'text-emerald-600',
    duration: 5000,
  },
  'sync-failed': {
    bg: 'bg-red-50',
    border: 'border-red-300',
    text: 'text-red-800',
    iconColor: 'text-red-500',
    duration: 8000,
  },
  'pending-items': {
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-800',
    iconColor: 'text-amber-600',
    duration: 5000,
  },
  'conflict-detected': {
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-800',
    iconColor: 'text-amber-600',
    duration: 8000,
  },
}

const MAX_VISIBLE = 3

let notificationIdCounter = 0

function generateId(): string {
  return `sync-notif-${Date.now()}-${++notificationIdCounter}`
}

// ============================================================
// Icon Renderer
// ============================================================

function NotificationIcon({ type, iconColor }: { type: NotificationType; iconColor: string }) {
  const className = `w-5 h-5 shrink-0 ${iconColor}`

  switch (type) {
    case 'online':
      return <Wifi className={className} />
    case 'offline':
      return <WifiOff className={className} />
    case 'sync-started':
      return <RefreshCw className={`${className} animate-spin`} />
    case 'sync-completed':
      return <CheckCircle2 className={className} />
    case 'sync-failed':
      return <AlertCircle className={className} />
    case 'pending-items':
      return <AlertTriangle className={className} />
    case 'conflict-detected':
      return <AlertTriangle className={className} />
    default:
      return <AlertCircle className={className} />
  }
}

// ============================================================
// Single Notification Toast
// ============================================================

function NotificationToast({
  notification,
  onDismiss,
}: {
  notification: SyncNotification
  onDismiss: (id: string) => void
}) {
  const config = NOTIFICATION_CONFIG[notification.type]

  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(notification.id)
    }, notification.autoDismiss)

    return () => clearTimeout(timer)
  }, [notification.id, notification.autoDismiss, onDismiss])

  return (
    <div
      role="alert"
      aria-live="polite"
      dir="rtl"
      className={`
        flex items-start gap-3 w-full max-w-[400px] p-4 rounded-lg shadow-lg border
        ${config.bg} ${config.border}
        animate-in slide-in-from-top-2 fade-in duration-300
      `}
    >
      <NotificationIcon type={notification.type} iconColor={config.iconColor} />

      <p className={`flex-1 text-sm font-medium leading-relaxed ${config.text}`}>
        {notification.message}
      </p>

      <button
        onClick={() => onDismiss(notification.id)}
        className={`
          shrink-0 p-0.5 rounded-md transition-colors
          hover:bg-black/5 focus:outline-none focus:ring-1 focus:ring-current
          ${config.text} opacity-60 hover:opacity-100
        `}
        aria-label="إغلاق الإشعار"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

// ============================================================
// Main Component
// ============================================================

export function SyncNotifications({ orgId }: SyncNotificationsProps) {
  const [notifications, setNotifications] = useState<SyncNotification[]>([])
  const syncStatus = useSyncStatus()
  const online = useOnlineStatus()

  // Track previous state to detect transitions
  const prevOnlineRef = React.useRef<boolean | null>(null)
  const prevSyncingRef = React.useRef<boolean | null>(null)
  const prevPendingCountRef = React.useRef<number>(0)
  const prevErrorsRef = React.useRef<string[]>([])

  // ============================================================
  // Add / Dismiss helpers
  // ============================================================

  const addNotification = useCallback(
    (type: NotificationType, message: string, durationOverride?: number) => {
      const config = NOTIFICATION_CONFIG[type]
      const notification: SyncNotification = {
        id: generateId(),
        type,
        message,
        timestamp: Date.now(),
        autoDismiss: durationOverride ?? config.duration,
      }

      setNotifications((prev) => {
        // Stack new on top, limit to MAX_VISIBLE
        const updated = [notification, ...prev]
        return updated.slice(0, MAX_VISIBLE)
      })
    },
    []
  )

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }, [])

  // ============================================================
  // Watch online/offline transitions
  // ============================================================

  useEffect(() => {
    const prevOnline = prevOnlineRef.current

    // Only react to transitions, not initial render
    if (prevOnline !== null) {
      if (prevOnline === false && online === true) {
        // Came back online
        addNotification('online', 'تم الاتصال بالخادم')
      } else if (prevOnline === true && online === false) {
        // Went offline
        addNotification('offline', 'تم فقدان الاتصال — التغييرات تُحفظ محلياً')
      }
    }

    prevOnlineRef.current = online
  }, [online, addNotification])

  // ============================================================
  // Watch sync status transitions
  // ============================================================

  useEffect(() => {
    const prevSyncing = prevSyncingRef.current
    const prevPendingCount = prevPendingCountRef.current
    const prevErrors = prevErrorsRef.current

    // Only react to transitions, not initial render
    if (prevSyncing !== null) {
      // Sync started
      if (!prevSyncing && syncStatus.isSyncing) {
        addNotification('sync-started', 'جاري المزامنة...')
      }

      // Sync completed (was syncing, now not syncing)
      if (prevSyncing && !syncStatus.isSyncing) {
        // Check if there were errors
        if (syncStatus.errors.length > 0) {
          addNotification(
            'sync-failed',
            `فشلت المزامنة — ${syncStatus.errors.length} أخطاء`
          )
        } else {
          // Calculate total synced records from last sync
          const syncedRecords = Math.max(
            0,
            prevPendingCount - syncStatus.pendingCount
          )
          if (syncedRecords > 0) {
            addNotification(
              'sync-completed',
              `تمت المزامنة بنجاح — ${syncedRecords} سجلات`
            )
          } else {
            addNotification('sync-completed', 'تمت المزامنة بنجاح')
          }
        }
      }
    }

    // Pending items count changed (only when not syncing, to avoid spam)
    if (!syncStatus.isSyncing && prevPendingCount !== null) {
      if (
        syncStatus.pendingCount > 0 &&
        syncStatus.pendingCount !== prevPendingCount &&
        syncStatus.pendingCount > prevPendingCount
      ) {
        addNotification(
          'pending-items',
          `${syncStatus.pendingCount} عمليات معلقة تنتظر المزامنة`
        )
      }
    }

    // New errors appeared while not syncing (e.g., conflict detection)
    if (
      !syncStatus.isSyncing &&
      syncStatus.errors.length > 0 &&
      syncStatus.errors.length > prevErrors.length
    ) {
      const newErrorCount = syncStatus.errors.length - prevErrors.length
      // Check if any new errors mention "conflict" to show conflict notification
      const newErrors = syncStatus.errors.slice(prevErrors.length)
      const conflictErrors = newErrors.filter((e) =>
        /conflict|تعارض|CONFLICT/i.test(e)
      )

      if (conflictErrors.length > 0) {
        addNotification(
          'conflict-detected',
          `تم اكتشاف ${conflictErrors.length} تعارضات`
        )
      } else if (newErrorCount > 0 && prevErrors.length > 0) {
        // Additional errors appeared but not conflicts
        addNotification(
          'sync-failed',
          `فشلت المزامنة — ${syncStatus.errors.length} أخطاء`
        )
      }
    }

    // Update refs
    prevSyncingRef.current = syncStatus.isSyncing
    prevPendingCountRef.current = syncStatus.pendingCount
    prevErrorsRef.current = syncStatus.errors
  }, [syncStatus, addNotification])

  // ============================================================
  // Render
  // ============================================================

  if (notifications.length === 0) {
    return null
  }

  return (
    <div
      className="fixed top-4 left-4 z-[100] flex flex-col gap-2"
      dir="rtl"
      aria-label="إشعارات المزامنة"
    >
      {notifications.map((notification) => (
        <NotificationToast
          key={notification.id}
          notification={notification}
          onDismiss={dismissNotification}
        />
      ))}
    </div>
  )
}
