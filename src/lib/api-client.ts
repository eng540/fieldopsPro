// FieldOps V4 — API Client (FastAPI Wired)
// All requests go to FastAPI backend. No mock API routes.

import {
  db, addToSyncQueue, getPendingSyncItems, updateSyncQueueItem,
  clearCompletedSyncItems, getPendingSyncCount,
} from './offline-db'

// ============================================================
// Types
// ============================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  fromCache?: boolean
  syncedAt?: number
}

export interface SyncStatus {
  isOnline: boolean
  isSyncing: boolean
  pendingCount: number
  lastSyncAt: number | null
  errors: string[]
}

// ============================================================
// Configuration
// ============================================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const authData = localStorage.getItem('fieldops-auth')
    if (!authData) return null
    const parsed = JSON.parse(authData)
    return parsed?.state?.tokens?.accessToken || null
  } catch {
    return null
  }
}

// ============================================================
// Network Detection
// ============================================================

let onlineStatus = typeof window !== 'undefined' ? navigator.onLine : true
const onlineListeners: Set<(online: boolean) => void> = new Set()

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    onlineStatus = true
    onlineListeners.forEach(fn => fn(true))
    processSyncQueue()
  })
  window.addEventListener('offline', () => {
    onlineStatus = false
    onlineListeners.forEach(fn => fn(false))
  })
}

export function isOnline(): boolean {
  return onlineStatus
}

export function onOnlineStatusChange(listener: (online: boolean) => void): () => void {
  onlineListeners.add(listener)
  return () => onlineListeners.delete(listener)
}

// ============================================================
// API Client — FastAPI Backend Only
// ============================================================

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  fallbackToCache: boolean = true
): Promise<ApiResponse<T>> {
  if (!onlineStatus && fallbackToCache) {
    return { success: false, error: 'OFFLINE', fromCache: false }
  }

  const token = getAccessToken()

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })

    if (res.status === 401) {
      return { success: false, error: 'UNAUTHORIZED' }
    }

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      return { success: false, error: errorData.detail || errorData.error || `HTTP ${res.status}` }
    }

    const data = await res.json()
    return { success: true, data }
  } catch (error) {
    if (!onlineStatus && fallbackToCache) {
      return { success: false, error: 'OFFLINE', fromCache: false }
    }
    return { success: false, error: String(error) }
  }
}

// ============================================================
// File Upload Client — Multipart to FastAPI
// ============================================================

async function uploadFile(
  endpoint: string,
  files: File[],
  extraFields?: Record<string, string>
): Promise<ApiResponse<{ uploaded: number; urls: string[] }>> {
  if (!onlineStatus) {
    return { success: false, error: 'OFFLINE' }
  }

  const token = getAccessToken()
  const formData = new FormData()

  for (const file of files) {
    formData.append('files', file)
  }

  if (extraFields) {
    for (const [key, value] of Object.entries(extraFields)) {
      formData.append(key, value)
    }
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: formData,
    })

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}))
      return { success: false, error: errorData.detail || `HTTP ${res.status}` }
    }

    const data = await res.json()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

// ============================================================
// Sync Engine — Wired to FastAPI /sync/push and /sync/pull
// ============================================================

let isSyncing = false
let syncErrors: string[] = []
const syncListeners: Set<(status: SyncStatus) => void> = new Set()

function notifySyncListeners(pendingCount: number) {
  const status: SyncStatus = {
    isOnline: onlineStatus,
    isSyncing,
    pendingCount,
    lastSyncAt: null,
    errors: [...syncErrors],
  }
  syncListeners.forEach(fn => fn(status))
}

export function onSyncStatusChange(listener: (status: SyncStatus) => void): () => void {
  syncListeners.add(listener)
  return () => syncListeners.delete(listener)
}

// ============================================================
// processSyncQueue — Pushes pending operations to FastAPI /sync/push
// Payload matches SyncPushRequest from openapi.yaml
// ============================================================

export async function processSyncQueue(): Promise<{
  processed: number
  failed: number
  remaining: number
  conflicts: Array<{
    operation_uuid: string
    conflict_type: string
    server_value: Record<string, unknown>
    client_value: Record<string, unknown>
    resolution_hint: string
  }>
}> {
  if (isSyncing || !onlineStatus) return { processed: 0, failed: 0, remaining: 0, conflicts: [] }

  isSyncing = true
  syncErrors = []
  let processed = 0
  let failed = 0
  const allConflicts: Array<{
    operation_uuid: string
    conflict_type: string
    server_value: Record<string, unknown>
    client_value: Record<string, unknown>
    resolution_hint: string
  }> = []

  try {
    const pendingItems = await getPendingSyncItems()
    notifySyncListeners(pendingItems.length)

    if (pendingItems.length === 0) {
      isSyncing = false
      return { processed: 0, failed: 0, remaining: 0, conflicts: [] }
    }

    // Build SyncPushRequest payload matching openapi.yaml
    const operations = pendingItems.map(item => {
      const payload = JSON.parse(item.payload)
      return {
        operation_uuid: item.operationUuid,
        operation_type: item.operationType,
        entity_type: _mapEntityType(item.entityType),
        entity_id: _extractEntityId(payload, item),
        payload: payload,
        device_timestamp: new Date(item.createdAt).toISOString(),
      }
    })

    const token = getAccessToken()
    const res = await fetch(`${API_BASE}/sync/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ operations }),
    })

    if (res.ok || res.status === 207) {
      const data = await res.json()

      // Mark processed items as COMPLETED
      for (const uuid of (data.processed || [])) {
        const item = pendingItems.find(i => i.operationUuid === uuid)
        if (item?.id) {
          await updateSyncQueueItem(item.id, {
            status: 'COMPLETED',
            processedAt: Date.now(),
          })
          processed++
        }
      }

      // Handle conflicts (207 Multi-Status)
      // Store server_value from each conflict for the ConflictResolutionPanel
      for (const conflict of (data.conflicts || [])) {
        const item = pendingItems.find(i => i.operationUuid === conflict.operation_uuid)
        if (item?.id) {
          await updateSyncQueueItem(item.id, {
            status: 'CONFLICT',
            lastError: `${conflict.conflict_type}: ${conflict.resolution_hint}`,
            // Store server data as JSON for the merge dialog
            serverData: conflict.server_value || null,
          })
          failed++
        }
        allConflicts.push(conflict)
        syncErrors.push(`${conflict.conflict_type}: ${conflict.resolution_hint}`)
      }

      // Clean up completed items
      await clearCompletedSyncItems()
    } else if (res.status === 409) {
      // All blocked by governance
      const data = await res.json()
      for (const conflict of (data.conflicts || [])) {
        const item = pendingItems.find(i => i.operationUuid === conflict.operation_uuid)
        if (item?.id) {
          await updateSyncQueueItem(item.id, {
            status: 'CONFLICT',
            lastError: `${conflict.conflict_type}: ${conflict.resolution_hint}`,
          })
          failed++
        }
        allConflicts.push(conflict)
        syncErrors.push(`BLOCKED: ${conflict.resolution_hint}`)
      }
    } else {
      // Server error — retry later
      for (const item of pendingItems) {
        await updateSyncQueueItem(item.id!, {
          status: 'PENDING',
          retryCount: item.retryCount + 1,
          lastError: `HTTP ${res.status}`,
        })
      }
    }
  } catch (err) {
    syncErrors.push(String(err))
  } finally {
    isSyncing = false
    const remaining = await getPendingSyncCount()
    notifySyncListeners(remaining)
  }

  return {
    processed,
    failed,
    remaining: await getPendingSyncCount(),
    conflicts: allConflicts,
  }
}

// ============================================================
// fullDataSync — Pull from FastAPI /sync/pull
// ============================================================

export async function fullDataSync(orgId: string): Promise<{
  success: boolean
  synced: { projects: number; users: number; remarks: number; auditLogs: number; dictionaries: number }
  errors: string[]
}> {
  const errors: string[] = []
  const synced = { projects: 0, users: 0, remarks: 0, auditLogs: 0, dictionaries: 0 }

  if (!onlineStatus) {
    return { success: false, synced, errors: ['OFFLINE'] }
  }

  isSyncing = true
  notifySyncListeners(0)

  try {
    const token = getAccessToken()

    // Pull from /sync/pull
    const pullRes = await fetch(`${API_BASE}/sync/pull`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        last_sync_version: null, // Full sync
      }),
    })

    if (pullRes.ok) {
      const pullData = await pullRes.json()
      // Cache work orders from pull bundle to local DB
      if (pullData.bundle?.work_orders) {
        for (const wo of pullData.bundle.work_orders) {
          await db.boqProgress.put({
            id: `wo-${wo.id}`,
            orgId: String(wo.org_id),
            unitId: String(wo.project_id),
            boqItemId: `wo-${wo.id}`,
            completionPct: wo.completion_pct,
            status: wo.status,
            measuredQuantity: null,
            reworkFlag: wo.rework_flag,
            reworkReason: null,
            reworkAuthorizedBy: null,
            updatedBy: null,
            pendingSync: false,
            lastSyncedAt: Date.now(),
          })
        }
        synced.projects = pullData.bundle.work_orders.length
      }
    } else errors.push('sync/pull: ' + String(pullRes.status))

    // Pull users, remarks, audit logs from FastAPI
    const [userRes, remarkRes, auditRes] = await Promise.all([
      apiRequest<{ items: unknown[] }>(`/auth/users`),
      apiRequest<{ items: unknown[] }>(`/quality/remarks`),
      apiRequest<{ items: unknown[] }>(`/auth/audit?page_size=100`),
    ])

    if (userRes.success && userRes.data) synced.users = (userRes.data as any).length || 0
    else errors.push('users: ' + (userRes.error || 'unknown'))

    if (remarkRes.success && remarkRes.data) synced.remarks = (remarkRes.data as any).length || 0
    else errors.push('remarks: ' + (remarkRes.error || 'unknown'))

    if (auditRes.success && auditRes.data) synced.auditLogs = (auditRes.data as any).length || 0
    else errors.push('audit: ' + (auditRes.error || 'unknown'))

    // Push pending changes
    await processSyncQueue()

    return { success: errors.length === 0, synced, errors }
  } catch (err) {
    errors.push(String(err))
    return { success: false, synced, errors }
  } finally {
    isSyncing = false
    const remaining = await getPendingSyncCount()
    notifySyncListeners(remaining)
  }
}

// ============================================================
// Hybrid Data Access — Online First, Offline Fallback
// ============================================================

export async function getProjectsHybrid(orgId: string): Promise<{
  data: any[]; fromCache: boolean
}> {
  if (onlineStatus) {
    try {
      const res = await apiRequest<any>(`/projects?org_id=${orgId}`)
      if (res.success && res.data) {
        return { data: res.data.projects || res.data.items || res.data, fromCache: false }
      }
    } catch (err) {
      console.warn('Online fetch failed, falling back to cache:', err)
    }
  }
  const localData = await getLocalProjects()
  return { data: localData, fromCache: true }
}

export async function getRemarksHybrid(orgId: string): Promise<{
  data: any[]; fromCache: boolean
}> {
  if (onlineStatus) {
    try {
      const res = await apiRequest<any>(`/quality/remarks`)
      if (res.success && res.data) {
        return { data: res.data.items || res.data, fromCache: false }
      }
    } catch (err) {
      console.warn('Online fetch failed, falling back to cache:', err)
    }
  }
  const localData = await getLocalRemarks()
  return { data: localData, fromCache: true }
}

export async function getUsersHybrid(orgId: string): Promise<{
  data: any[]; fromCache: boolean
}> {
  if (onlineStatus) {
    try {
      const res = await apiRequest<any>(`/auth/users`)
      if (res.success && res.data) {
        return { data: Array.isArray(res.data) ? res.data : res.data.users || [], fromCache: false }
      }
    } catch (err) {
      console.warn('Online fetch failed, falling back to cache:', err)
    }
  }
  const localData = await getLocalUsers()
  return { data: localData, fromCache: true }
}

export async function getAuditLogsHybrid(orgId: string): Promise<{
  data: any[]; fromCache: boolean
}> {
  if (onlineStatus) {
    try {
      const res = await apiRequest<any>(`/auth/audit?page_size=100`)
      if (res.success && res.data) {
        return { data: res.data.items || res.data, fromCache: false }
      }
    } catch (err) {
      console.warn('Online fetch failed, falling back to cache:', err)
    }
  }
  const localData = await getLocalAuditLogs()
  return { data: localData, fromCache: true }
}

export async function getDictionariesHybrid(orgId: string): Promise<{
  data: any[]; fromCache: boolean
}> {
  if (onlineStatus) {
    try {
      const res = await apiRequest<any>(`/projects/dictionaries?org_id=${orgId}`)
      if (res.success && res.data) {
        return { data: res.data.dictionaries || res.data.items || res.data, fromCache: false }
      }
    } catch (err) {
      console.warn('Online fetch failed, falling back to cache:', err)
    }
  }
  const localData = await getLocalDictionaries()
  return { data: localData, fromCache: true }
}

// ============================================================
// Local Data Accessors (IndexedDB)
// ============================================================

export async function getLocalProjects(): Promise<any[]> {
  const projects = await db.projects.toArray()
  const result = []
  for (const project of projects) {
    const units = await db.units.where('projectId').equals(project.id).toArray()
    const unitsWithBoq = []
    for (const unit of units) {
      const boqItems = await db.boqItems.where('unitId').equals(unit.id).toArray()
      unitsWithBoq.push({ ...unit, boqItems })
    }
    result.push({ ...project, units: unitsWithBoq })
  }
  return result
}

export async function getLocalRemarks(): Promise<any[]> {
  const remarks = await db.remarks.toArray()
  return remarks.map(r => ({
    ...r,
    photos: typeof r.photos === 'string' ? JSON.parse(r.photos) : r.photos,
    gpsTag: r.gpsTag ? (typeof r.gpsTag === 'string' ? JSON.parse(r.gpsTag) : r.gpsTag) : null,
    unit: { id: r.unitId, name: '', code: '' },
  }))
}

export async function getLocalUsers(): Promise<any[]> {
  const users = await db.users.toArray()
  return users.map(u => ({
    ...u,
    assignments: typeof u.assignments === 'string' ? JSON.parse(u.assignments) : u.assignments,
  }))
}

export async function getLocalAuditLogs(): Promise<any[]> {
  const logs = await db.auditLogs.toArray()
  return logs.map(l => ({
    ...l,
    details: typeof l.details === 'string' ? JSON.parse(l.details) : l.details,
  }))
}

export async function getLocalDictionaries(): Promise<any[]> {
  const dicts = await db.dictionaries.toArray()
  return dicts.map(d => ({
    ...d,
    items: typeof d.items === 'string' ? JSON.parse(d.items) : d.items,
  }))
}

// ============================================================
// Upload Photos to FastAPI S3 endpoint
// ============================================================

export async function uploadPhotosToServer(
  remarkId: string,
  files: File[]
): Promise<{ uploaded: number; urls: string[] }> {
  const result = await uploadFile(
    `/quality/remarks/${remarkId}/photos`,
    files
  )
  if (result.success && result.data) {
    return result.data
  }
  throw new Error(result.error || 'Upload failed')
}

// ============================================================
// Helpers
// ============================================================

function _mapEntityType(localType: string): string {
  const map: Record<string, string> = {
    'project': 'WORK_ORDER',
    'unit': 'UNIT_PROGRESS',
    'boqProgress': 'UNIT_PROGRESS',
    'remark': 'REMARK',
    'photo': 'REMARK',
    'user': 'WORK_ORDER',
    'dictionary': 'WORK_ORDER',
  }
  return map[localType] || 'WORK_ORDER'
}

function _extractEntityId(payload: any, item: { entityType: string; operationUuid: string }): string {
  if (payload.unitId) return payload.unitId
  if (payload.entity_id) return payload.entity_id
  if (payload.id) return payload.id
  return item.operationUuid
}
