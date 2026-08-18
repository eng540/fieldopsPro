// FieldOps V4 — API Client
// Centralized authenticated transport for the FastAPI backend.

import { db, getPendingSyncItems, updateSyncQueueItem, clearCompletedSyncItems, getPendingSyncCount } from './offline-db'
import type { SyncQueueItem } from './offline-db'
import { useAuthStore } from './auth-store'

export interface ApiResponse<T = unknown> { success: boolean; data?: T; error?: string; fromCache?: boolean; syncedAt?: number }
export interface SyncStatus { isOnline: boolean; isSyncing: boolean; pendingCount: number; lastSyncAt: number | null; errors: string[] }

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'
const REQUEST_TIMEOUT_MS = 10_000
function getAccessToken(): string | null { return useAuthStore.getState().tokens?.accessToken || null }
function snakeToCamelKey(key: string): string { return key.replace(/_([a-zA-Z0-9])/g, (_, char: string) => char.toUpperCase()) }
function normalizeApiData<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => normalizeApiData(item)) as T
  if (value && typeof value === 'object' && !(value instanceof Date)) { const source = value as Record<string, unknown>; const result: Record<string, unknown> = {}; for (const [key, item] of Object.entries(source)) result[snakeToCamelKey(key)] = normalizeApiData(item); return result as T }
  return value
}
async function normalizedHybrid<T>(request: Promise<ApiResponse<T>>): Promise<ApiResponse<T>> { const response = await request; if (response.success && response.data !== undefined) return { ...response, data: normalizeApiData(response.data) }; return response }

let onlineStatus = typeof window !== 'undefined' ? navigator.onLine : true
const onlineListeners: Set<(online: boolean) => void> = new Set()
if (typeof window !== 'undefined') { window.addEventListener('online', () => { onlineStatus = true; onlineListeners.forEach(fn => fn(true)); processSyncQueue() }); window.addEventListener('offline', () => { onlineStatus = false; onlineListeners.forEach(fn => fn(false)) }) }
export function isOnline(): boolean { return onlineStatus }
export function onOnlineStatusChange(listener: (online: boolean) => void): () => void { onlineListeners.add(listener); return () => onlineListeners.delete(listener) }

async function requestOnce(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    })
  } finally {
    clearTimeout(timeout)
  }
}

/** Central authenticated request primitive. */
export async function apiRequest<T>(endpoint: string, options: RequestInit = {}, fallbackToCache = true): Promise<ApiResponse<T>> {
  if (!onlineStatus && fallbackToCache) return { success: false, error: 'OFFLINE', fromCache: false }
  try {
    let res = await requestOnce(endpoint, options)
    if (res.status === 401) { try { await useAuthStore.getState().refreshAccessToken(); res = await requestOnce(endpoint, options) } catch { return { success: false, error: 'UNAUTHORIZED' } }; if (res.status === 401) return { success: false, error: 'UNAUTHORIZED' } }
    if (!res.ok) { const errorData = await res.json().catch(() => ({})); return { success: false, error: errorData.detail || errorData.error || `HTTP ${res.status}` } }
    return { success: true, data: await res.json() }
  } catch (error: any) {
    if (!onlineStatus && fallbackToCache) return { success: false, error: 'OFFLINE', fromCache: false }
    return { success: false, error: error?.name === 'AbortError' ? 'REQUEST_TIMEOUT' : String(error) }
  }
}

async function uploadFile(endpoint: string, files: File[], extraFields?: Record<string, string>): Promise<ApiResponse<{ uploaded: number; urls: string[] }>> { if (!onlineStatus) return { success: false, error: 'OFFLINE' }; const formData = new FormData(); for (const file of files) formData.append('files', file); if (extraFields) for (const [key, value] of Object.entries(extraFields)) formData.append(key, value); const send = () => fetch(`${API_BASE}${endpoint}`, { method: 'POST', credentials: 'include', headers: { ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}) }, body: formData }); try { let res = await send(); if (res.status === 401) { await useAuthStore.getState().refreshAccessToken(); res = await send() }; if (!res.ok) { const e = await res.json().catch(() => ({})); return { success: false, error: typeof e.detail === 'string' ? e.detail : e.detail?.message || `HTTP ${res.status}` } }; return { success: true, data: await res.json() } } catch (error) { return { success: false, error: String(error) } } }

/** Upload one Excel file through the authenticated FastAPI multipart contract. */
export async function uploadMultipart<T>(endpoint: string, file: File): Promise<ApiResponse<T>> { if (!onlineStatus) return { success: false, error: 'OFFLINE' }; const formData = new FormData(); formData.append('file', file); const send = () => fetch(`${API_BASE}${endpoint}`, { method: 'POST', credentials: 'include', headers: { ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}) }, body: formData }); try { let res = await send(); if (res.status === 401) { await useAuthStore.getState().refreshAccessToken(); res = await send() }; if (!res.ok) { const errorData = await res.json().catch(() => ({})); const detail = errorData.detail; return { success: false, error: typeof detail === 'string' ? detail : detail?.message || errorData.error || `HTTP ${res.status}` } }; return { success: true, data: await res.json() } } catch (error: any) { return { success: false, error: error?.name === 'AbortError' ? 'REQUEST_TIMEOUT' : String(error) } } }

let isSyncing = false
let syncErrors: string[] = []
let lastSyncAt: number | null = null
const syncListeners: Set<(status: SyncStatus) => void> = new Set()
function notifySyncListeners(pendingCount: number) { syncListeners.forEach(fn => fn({ isOnline: onlineStatus, isSyncing, pendingCount, lastSyncAt, errors: [...syncErrors] })) }
export function onSyncStatusChange(listener: (status: SyncStatus) => void): () => void { syncListeners.add(listener); return () => syncListeners.delete(listener) }

/** Public sync entrypoint used by the offline UI and online recovery handler. */
export async function processSyncQueue(): Promise<{ processed: number; failed: number; remaining: number; conflicts: any[] }> { if (isSyncing || !onlineStatus) return { processed: 0, failed: 0, remaining: 0, conflicts: [] }; isSyncing = true; syncErrors = []; let processed = 0; let failed = 0; const conflicts: any[] = []; let pendingItems: SyncQueueItem[] = []; try { pendingItems = await getPendingSyncItems(); notifySyncListeners(pendingItems.length); if (!pendingItems.length) return { processed: 0, failed: 0, remaining: 0, conflicts: [] }; for (const item of pendingItems.filter(candidate => candidate.entityType === 'photo')) {
      try {
        const payload = JSON.parse(item.payload)
        const photo = payload.photoId ? await db.photos.get(String(payload.photoId)) : undefined
        if (!photo) throw new Error('PHOTO_LOCAL_BLOB_NOT_FOUND')
        const file = new File([photo.blob], `photo-${photo.id}.jpg`, { type: photo.blob.type || 'image/jpeg' })
        const uploaded = await uploadFile(item.endpoint, [file])
        if (!uploaded.success) throw new Error(uploaded.error || 'PHOTO_UPLOAD_FAILED')
        await db.photos.update(photo.id, { uploadedAt: new Date().toISOString(), pendingSync: false })
        await updateSyncQueueItem(item.id!, { status: 'COMPLETED', processedAt: Date.now(), lastError: null })
        item.status = 'COMPLETED'
        processed++
      } catch (error) {
        const message = String(error)
        const retryCount = item.retryCount + 1
        const terminal = retryCount >= item.maxRetries
        await updateSyncQueueItem(item.id!, { status: terminal ? 'FAILED' : 'PENDING', retryCount, lastError: message })
        if (terminal) failed++
        syncErrors.push(message)
      }
    }
    const operations = pendingItems.filter(item => item.entityType !== 'photo').map(item => { const payload = JSON.parse(item.payload); return { operation_uuid: item.operationUuid, operation_type: item.operationType, entity_type: _mapEntityType(item.entityType), entity_id: _extractEntityId(payload, item), payload, device_timestamp: new Date(item.createdAt).toISOString() } }); const send = () => fetch(`${API_BASE}/sync/push`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}) }, body: JSON.stringify({ operations }) }); let res: Response | null = operations.length ? await send() : null; if (res?.status === 401) { await useAuthStore.getState().refreshAccessToken(); res = await send() }; if (res && (res.ok || res.status === 207)) { const data = await res.json(); for (const uuid of data.processed || []) { const item = pendingItems.find(i => i.operationUuid === uuid); if (item?.id) { await updateSyncQueueItem(item.id, { status: 'COMPLETED', processedAt: Date.now() }); processed++ } }; for (const conflict of data.conflicts || []) { const item = pendingItems.find(i => i.operationUuid === conflict.operation_uuid); if (item?.id) { await updateSyncQueueItem(item.id, { status: 'CONFLICT', lastError: `${conflict.conflict_type}: ${conflict.resolution_hint}`, serverData: conflict.server_value || null }); failed++ }; conflicts.push(conflict); syncErrors.push(`${conflict.conflict_type}: ${conflict.resolution_hint}`) }; await clearCompletedSyncItems() } else if (res?.status === 409) { const data = await res.json(); for (const conflict of data.conflicts || []) { const item = pendingItems.find(i => i.operationUuid === conflict.operation_uuid); if (item?.id) await updateSyncQueueItem(item.id, { status: 'CONFLICT', lastError: `${conflict.conflict_type}: ${conflict.resolution_hint}` }); failed++; conflicts.push(conflict); syncErrors.push(`BLOCKED: ${conflict.resolution_hint}`) } } else if (res) { syncErrors.push(`HTTP ${res.status}`); for (const item of pendingItems) { if (item.status === 'COMPLETED') continue; const retryCount = item.retryCount + 1; const terminal = retryCount >= item.maxRetries; await updateSyncQueueItem(item.id!, { status: terminal ? 'FAILED' : 'PENDING', retryCount, lastError: `HTTP ${res.status}` }); if (terminal) failed++ } } } catch (err) { const message = String(err); syncErrors.push(message); for (const item of pendingItems) { if (item.status === 'COMPLETED') continue; const retryCount = item.retryCount + 1; const terminal = retryCount >= item.maxRetries; await updateSyncQueueItem(item.id!, { status: terminal ? 'FAILED' : 'PENDING', retryCount, lastError: message }); if (terminal) failed++ } } finally { isSyncing = false; lastSyncAt = Date.now(); notifySyncListeners(await getPendingSyncCount()) }; return { processed, failed, remaining: await getPendingSyncCount(), conflicts } }

export async function fullDataSync(orgId: string): Promise<{ success: boolean; synced: { projects: number; users: number; remarks: number; auditLogs: number; dictionaries: number }; errors: string[] }> {
  const errors: string[] = []
  const synced = { projects: 0, users: 0, remarks: 0, auditLogs: 0, dictionaries: 0 }
  if (!onlineStatus) return { success: false, synced, errors: ['OFFLINE'] }
  isSyncing = true
  notifySyncListeners(0)
  try {
    const pull = await apiRequest<any>('/sync/pull', { method: 'POST', body: JSON.stringify({ last_sync_version: null }) })
    if (pull.success) {
      // Work orders are not BOQ progress. Keep them out of db.boqProgress;
      // the online Work Orders screen reads the canonical execution endpoint.
      const projects = pull.data?.bundle?.projects || pull.data?.bundle?.project_units || []
      synced.projects = Array.isArray(projects) ? projects.length : 0
    } else {
      errors.push('sync/pull: ' + (pull.error || 'unknown'))
    }
    const [users, remarks, audit] = await Promise.all([
      apiRequest<any>('/auth/users'),
      apiRequest<any>('/quality/remarks'),
      apiRequest<any>('/auth/audit?page_size=100'),
    ])
    if (users.success) synced.users = Array.isArray(users.data) ? users.data.length : users.data?.items?.length || 0
    else errors.push('users: ' + (users.error || 'unknown'))
    if (remarks.success) synced.remarks = Array.isArray(remarks.data) ? remarks.data.length : remarks.data?.items?.length || 0
    else errors.push('remarks: ' + (remarks.error || 'unknown'))
    if (audit.success) synced.auditLogs = Array.isArray(audit.data) ? audit.data.length : Array.isArray(audit.data?.items) ? audit.data.items.length : 0
    else errors.push('audit: ' + (audit.error || 'unknown'))
    await processSyncQueue()
    return { success: errors.length === 0, synced, errors }
  } catch (err) {
    errors.push(String(err))
    return { success: false, synced, errors }
  } finally {
    isSyncing = false
    lastSyncAt = Date.now()
    notifySyncListeners(await getPendingSyncCount())
  }
}

function normalizeProjectBoqItem(item: any) {
  return {
    ...item,
    id: String(item.id),
    projectId: String(item.projectId ?? item.project_id ?? ''),
    unitOfMeasure: item.unitOfMeasure ?? item.unit_of_measure ?? 'item',
    completionPct: Number(item.completionPct ?? item.completion_pct ?? 0),
  }
}

async function listAllExecutionStates(projectId: string): Promise<any[]> {
  const items: any[] = []
  let page = 1
  let total = 0
  let hasMore = true
  while (hasMore) {
    const result = await normalizedHybrid(apiRequest<any>(`/execution/state?project_id=${encodeURIComponent(projectId)}&page=${page}&page_size=500`))
    if (!result.success || !result.data) return items
    const pageItems = Array.isArray(result.data.items) ? result.data.items : []
    items.push(...pageItems)
    total = Number(result.data.total ?? items.length)
    hasMore = Boolean(result.data.hasMore ?? result.data.has_more) && items.length < total
    page += 1
    if (page > 1000) throw new Error('Execution state pagination exceeded safety limit')
  }
  return items
}

async function hydrateProjectRuntime(project: any): Promise<any> {
  const projectId = String(project.id)
  const [canonicalResult, aggregationResult, states] = await Promise.all([
    normalizedHybrid(apiRequest<any>(`/projects/${encodeURIComponent(projectId)}/canonical-boq`)),
    normalizedHybrid(apiRequest<any>(`/execution/aggregation/project/${encodeURIComponent(projectId)}`)),
    listAllExecutionStates(projectId),
  ])
  const canonical = canonicalResult.success && canonicalResult.data ? canonicalResult.data : {}
  const aggregation = aggregationResult.success && aggregationResult.data ? aggregationResult.data : {}
  const boqItems = (Array.isArray(canonical.boqItems)
    ? canonical.boqItems
    : Array.isArray(canonical.boq_items)
      ? canonical.boq_items
      : Array.isArray(project.boqItems)
        ? project.boqItems
        : Array.isArray(project.boq_items)
          ? project.boq_items
          : []).map(normalizeProjectBoqItem)
  const boqById = new Map(boqItems.map((item: any) => [String(item.id), item]))
  const assignments = (Array.isArray(canonical.assignments)
    ? canonical.assignments
    : Array.isArray(canonical.unit_boq_assignments)
      ? canonical.unit_boq_assignments
      : []).map((assignment: any) => ({
        ...assignment,
        unitId: String(assignment.unitId ?? assignment.unit_id ?? ''),
        boqItemId: String(assignment.boqItemId ?? assignment.boq_item_id ?? ''),
        plannedQuantity: Number(assignment.plannedQuantity ?? assignment.planned_quantity ?? 0),
        isActive: assignment.isActive ?? assignment.is_active ?? true,
      }))
  const stateByKey = new Map<string, any>(states.map((state: any) => {
    const normalized = {
      ...state,
      unitId: String(state.unitId ?? state.unit_id ?? ''),
      boqItemId: String(state.boqItemId ?? state.boq_item_id ?? ''),
      completionPct: Number(state.completionPct ?? state.completion_pct ?? 0),
      stateVersion: Number(state.stateVersion ?? state.state_version ?? 1),
      actualQuantity: state.actualQuantity ?? state.actual_quantity ?? null,
      status: state.status ?? 'NOT_STARTED',
    }
    return [`${normalized.unitId}:${normalized.boqItemId}`, normalized] as [string, any]
  }))
  const aggregationUnits = new Map<string, any>((Array.isArray(aggregation.units) ? aggregation.units : []).map((unit: any) => [String(unit.unitId ?? unit.unit_id), unit] as [string, any]))
  const canonicalUnits = Array.isArray(canonical.units) ? canonical.units : Array.isArray(canonical.project_units) ? canonical.project_units : []
  const baseUnits = canonicalUnits.length ? canonicalUnits : (Array.isArray(project.units) ? project.units : Array.isArray(project.project_units) ? project.project_units : [])
  const units = baseUnits.map((unit: any) => {
    const unitId = String(unit.id)
    const assignedItems = assignments
      .filter((assignment: any) => String(assignment.unitId) === unitId && assignment.isActive !== false)
      .map((assignment: any) => {
        const item = boqById.get(String(assignment.boqItemId))
        if (!item) return null
        const state = stateByKey.get(`${unitId}:${String(assignment.boqItemId)}`)
        return {
          ...item,
          unitId,
          plannedQty: Number(assignment.plannedQuantity ?? 0),
          completionPct: Number(state?.completionPct ?? 0),
          status: state?.status ?? 'NOT_STARTED',
          stateVersion: Number(state?.stateVersion ?? 1),
          actualQuantity: state?.actualQuantity ?? null,
        }
      })
      .filter(Boolean)
    const legacyItems = (Array.isArray(unit.boqItems) ? unit.boqItems : []).map(normalizeProjectBoqItem)
    const executionUnit = aggregationUnits.get(unitId)
    const unitItems = assignedItems.length ? assignedItems : legacyItems
    const completionPct = unitItems.length
      ? unitItems.reduce((sum: number, item: any) => sum + Number(item.completionPct || 0), 0) / unitItems.length
      : Number(executionUnit?.completionPct ?? unit.completionPct ?? 0)
    return {
      ...unit,
      id: unitId,
      projectId: String(unit.projectId ?? unit.project_id ?? projectId),
      unitType: unit.unitType ?? unit.unit_type ?? '',
      areaSqm: unit.areaSqm ?? unit.area_sqm ?? null,
      completionPct: Number(completionPct.toFixed(2)),
      boqItems: unitItems,
    }
  })
  const overall = Number(aggregation.summary?.overallProgressPct ?? project.completionPct ?? 0)
  return {
    ...project,
    id: projectId,
    orgId: String(project.orgId ?? project.org_id ?? ''),
    totalUnits: units.length || Number(project.totalUnits ?? project.total_units ?? 0),
    completionPct: overall,
    isActive: project.isActive !== false,
    units,
    boqItems,
    assignments,
    executionSummary: aggregation.summary || null,
    executionUnits: aggregation.units || [],
  }
}

export async function getProjectsHybrid(orgId: string): Promise<{ data: any[]; fromCache: boolean }> {
  const r = await normalizedHybrid(apiRequest<any>(`/projects?org_id=${encodeURIComponent(orgId)}`))
  if (r.success && r.data) {
    const raw = r.data.projects || r.data.items || r.data
    const base = (Array.isArray(raw) ? raw : []).map((project: any) => ({
      ...project,
      id: String(project.id),
      orgId: String(project.orgId ?? project.org_id ?? ''),
      totalUnits: Number(project.totalUnits ?? project.total_units ?? 0),
      completionPct: Number(project.completionPct ?? project.completion_pct ?? 0),
      isActive: project.isActive !== false,
      units: (Array.isArray(project.units) ? project.units : Array.isArray(project.project_units) ? project.project_units : []).map((unit: any) => ({
        ...unit,
        id: String(unit.id),
        projectId: String(unit.projectId ?? unit.project_id ?? project.id),
        completionPct: Number(unit.completionPct ?? unit.completion_pct ?? 0),
        boqItems: (Array.isArray(unit.boqItems) ? unit.boqItems : Array.isArray(unit.boq_items) ? unit.boq_items : []).map(normalizeProjectBoqItem),
      })),
      boqItems: (Array.isArray(project.boqItems) ? project.boqItems : Array.isArray(project.boq_items) ? project.boq_items : []).map(normalizeProjectBoqItem),
      assignments: Array.isArray(project.assignments) ? project.assignments : Array.isArray(project.unit_boq_assignments) ? project.unit_boq_assignments : [],
    }))
    const data = await Promise.all(base.map(hydrateProjectRuntime))
    return { data, fromCache: false }
  }
  return { data: await getLocalProjects(), fromCache: true }
}
export async function getRemarksHybrid(orgId: string): Promise<{ data: any[]; fromCache: boolean }> { const r = await normalizedHybrid(apiRequest<any>('/quality/remarks')); if (r.success && r.data) { const raw = Array.isArray(r.data.items) ? r.data.items : Array.isArray(r.data) ? r.data : []; const data = raw.map((remark: any) => ({ ...remark, id: String(remark.id), orgId: String(remark.orgId ?? remark.org_id ?? orgId), unitId: String(remark.unitId ?? remark.unit_id ?? ''), customIssue: remark.customIssue ?? remark.custom_issue ?? null, severity: String(remark.severity ?? 'MINOR'), status: String(remark.status ?? 'OPEN'), photos: Array.isArray(remark.photos) ? remark.photos : [], unit: { id: String(remark.unit?.id ?? remark.unitId ?? remark.unit_id ?? ''), name: String(remark.unit?.name ?? remark.unit_name ?? ''), code: String(remark.unit?.code ?? remark.unit_code ?? '') } })); return { data, fromCache: false } } return { data: await getLocalRemarks(), fromCache: true } }
export async function getUsersHybrid(orgId: string): Promise<{ data: any[]; fromCache: boolean }> { const r = await normalizedHybrid(apiRequest<any>('/auth/users')); if (r.success && r.data) return { data: Array.isArray(r.data) ? r.data : Array.isArray(r.data.users) ? r.data.users : Array.isArray(r.data.items) ? r.data.items : [], fromCache: false }; return { data: await getLocalUsers(), fromCache: true } }
export async function getAuditLogsHybrid(orgId: string): Promise<{ data: any[]; fromCache: boolean }> { const r = await normalizedHybrid(apiRequest<any>('/auth/audit?page_size=100')); if (r.success && r.data) return { data: Array.isArray(r.data.items) ? r.data.items : Array.isArray(r.data) ? r.data : [], fromCache: false }; return { data: await getLocalAuditLogs(), fromCache: true } }
export async function getDictionariesHybrid(orgId: string): Promise<{ data: any[]; fromCache: boolean }> { const r = await normalizedHybrid(apiRequest<any>(`/projects/dictionaries?org_id=${encodeURIComponent(orgId)}`)); if (r.success && r.data) return { data: Array.isArray(r.data.dictionaries) ? r.data.dictionaries : Array.isArray(r.data.items) ? r.data.items : Array.isArray(r.data) ? r.data : [], fromCache: false }; return { data: await getLocalDictionaries(), fromCache: true } }
export async function getLocalProjects(): Promise<any[]> { const projects = await db.projects.toArray(); const result: any[] = []; for (const project of projects) { const units = await db.units.where('projectId').equals(project.id).toArray(); const unitsWithBoq: any[] = []; for (const unit of units) unitsWithBoq.push({ ...unit, boqItems: await db.boqItems.where('unitId').equals(unit.id).toArray() }); result.push({ ...project, units: unitsWithBoq }) } return result }
export async function getLocalRemarks(): Promise<any[]> { return (await db.remarks.toArray()).map(r => ({ ...r, photos: typeof r.photos === 'string' ? JSON.parse(r.photos) : r.photos, gpsTag: r.gpsTag ? (typeof r.gpsTag === 'string' ? JSON.parse(r.gpsTag) : r.gpsTag) : null, unit: { id: r.unitId, name: '', code: '' } })) }
export async function getLocalUsers(): Promise<any[]> { return (await db.users.toArray()).map(u => ({ ...u, assignments: typeof u.assignments === 'string' ? JSON.parse(u.assignments) : u.assignments })) }
export async function getLocalAuditLogs(): Promise<any[]> { return (await db.auditLogs.toArray()).map(l => ({ ...l, details: typeof l.details === 'string' ? JSON.parse(l.details) : l.details })) }
export async function getLocalDictionaries(): Promise<any[]> { return (await db.dictionaries.toArray()).map(d => ({ ...d, items: typeof d.items === 'string' ? JSON.parse(d.items) : d.items })) }
export async function uploadPhotosToServer(remarkId: string, files: File[]): Promise<{ uploaded: number; urls: string[] }> { const r = await uploadFile(`/quality/remarks/${remarkId}/photos`, files); if (r.success && r.data) return r.data; throw new Error(r.error || 'Upload failed') }
function _mapEntityType(localType: string): string { const map: Record<string, string> = { project: 'WORK_ORDER', unit: 'UNIT_PROGRESS', boqProgress: 'UNIT_PROGRESS', remark: 'REMARK', diary: 'DAILY_LOG', photo: 'REMARK', user: 'WORK_ORDER', dictionary: 'WORK_ORDER' }; return map[localType] || 'WORK_ORDER' }
function _extractEntityId(payload: any, item: { entityType: string; operationUuid: string }): string {
  if (payload.unit_id != null && payload.boq_item_id != null) return `${payload.unit_id}:${payload.boq_item_id}`
  return String(payload.id || payload.entity_id || payload.remark_id || payload.diary_id || payload.unitId || item.operationUuid)
}