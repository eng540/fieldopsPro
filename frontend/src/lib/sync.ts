/**
 * FieldOps V4.0 — Offline-First Sync Engine
 *
 * Server-reconciled synchronization plus the Execution Event Pipeline.
 */
import { db, type SyncOperation, type LocalBoQProgress, type LocalProject, type LocalUnit, type LocalRemarkTemplate, type LocalDecision, type LocalEventIntent } from './db'
import { apiPost, API_BASE } from './client'
import { v4 as uuidv4 } from 'uuid'

const SYNC_CONFIG = {
  BATCH_SIZE: 100,
  MAX_RETRIES: 3,
  HEARTBEAT_INTERVAL_MS: 30000,
  HEARTBEAT_URL: '/health',
} as const

let isActuallyOnline = navigator.onLine
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

export function startReachabilityMonitoring(): void {
  if (heartbeatTimer) return
  heartbeatTimer = setInterval(async () => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const response = await fetch(`${API_BASE}${SYNC_CONFIG.HEARTBEAT_URL}`, { method: 'HEAD', signal: controller.signal, cache: 'no-store' })
      clearTimeout(timeout)
      isActuallyOnline = response.ok
    } catch { isActuallyOnline = false }
  }, SYNC_CONFIG.HEARTBEAT_INTERVAL_MS)
}
export function stopReachabilityMonitoring(): void { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null } }
export function getReachability(): boolean { return isActuallyOnline }

interface RawBundle { projects?: any[]; units?: any[]; boq_items?: any[]; remark_templates?: any[]; decisions?: any[]; work_orders?: any[] }

export async function applySyncBundle(bundle: RawBundle): Promise<void> {
  if (!bundle) return
  await db.transaction('rw', [db.projects, db.units, db.boqProgress, db.remarkTemplates, db.decisions], async () => {
    if (bundle.projects?.length) {
      const localProjects: LocalProject[] = bundle.projects.map((p) => ({ id: p.id, orgId: p.org_id, name: p.name, code: p.code, status: p.status ?? 'DRAFT', location: p.location_data ? { latitude: p.location_data.lat ?? 0, longitude: p.location_data.lng ?? 0, governorate: p.location_data.governorate ?? '' } : undefined, startDate: p.start_date, endDate: p.end_date, lastSyncedAt: new Date().toISOString(), isActive: p.is_active ?? true }))
      await db.projects.bulkPut(localProjects)
    }
    if (bundle.units?.length) {
      const localUnits: LocalUnit[] = bundle.units.map((u) => ({ id: u.id, projectId: u.project_id, unitType: u.unit_type ?? 'SHELTER', unitCode: u.code ?? u.unit_code ?? String(u.id), status: u.status ?? 'PLANNED', beneficiaryCount: u.beneficiary_count, gpsCoordinates: u.gps_tag ? { lat: u.gps_tag.lat, lng: u.gps_tag.lng } : undefined, lastActivity: u.updated_at ?? new Date().toISOString(), lastSyncedAt: new Date().toISOString() }))
      await db.units.bulkPut(localUnits)
    }
    if (bundle.boq_items?.length) {
      for (const item of bundle.boq_items) {
        const unitId = item.unit_id ?? 0
        const boqItemId = item.id
        const existing = await db.boqProgress.where('[unitId+boqItemId]').equals([unitId, boqItemId]).first()
        if (!existing) {
          await db.boqProgress.put({ unitId, boqItemId, completionPct: item.completion_pct ?? 0, status: item.status ?? 'NOT_STARTED', measuredQuantity: item.measured_quantity, reworkFlag: false, lastUpdated: item.last_updated ?? new Date().toISOString(), pendingSync: false, stateVersion: item.state_version ?? 1, lastEventId: item.last_event_id })
        } else if (!existing.pendingSync) {
          await db.boqProgress.put({ ...existing, completionPct: item.completion_pct ?? existing.completionPct, status: item.status ?? existing.status, measuredQuantity: item.measured_quantity ?? existing.measuredQuantity, lastUpdated: item.last_updated ?? existing.lastUpdated, stateVersion: item.state_version ?? existing.stateVersion, lastEventId: item.last_event_id ?? existing.lastEventId })
        }
      }
    }
    if (bundle.remark_templates?.length) {
      await db.remarkTemplates.bulkPut(bundle.remark_templates.map((t) => ({ id: t.id, orgId: t.org_id, category: t.category, issue: t.issue, severity: t.severity, recommendedAction: t.recommended_action ?? '', autoHold: t.auto_hold ?? false })) as LocalRemarkTemplate[])
    }
    if (bundle.decisions?.length) {
      await db.decisions.bulkPut(bundle.decisions.map((d) => ({ id: d.id, unitId: d.unit_id, boqItemId: d.boq_item_id ?? 0, decision: d.decision, paymentPct: d.payment_pct ?? 0, flag: d.flag ?? '', matchedRule: d.matched_rule ?? '', reason: d.reason ?? '', policyVersion: d.policy_version ?? 1, override: d.is_overridden ? { overriddenBy: d.triggered_by, justification: '', overriddenAt: d.created_at } : undefined, createdAt: d.created_at })) as LocalDecision[])
    }
  })
}

export async function enqueueOperation(operation: Omit<SyncOperation, 'status' | 'retryCount'>): Promise<void> { await db.syncQueue.put({ ...operation, status: 'PENDING', retryCount: 0 }) }
export async function getPendingOperations(): Promise<SyncOperation[]> { return db.syncQueue.where('status').equals('PENDING').limit(SYNC_CONFIG.BATCH_SIZE).toArray() }

export interface SyncPullResult { success: boolean; hasMore: boolean; syncVersion: string; error?: string }
export async function pullFromServer(lastSyncVersion?: string | null): Promise<SyncPullResult> {
  if (!isActuallyOnline) return { success: false, hasMore: false, syncVersion: '', error: 'Offline' }
  try {
    const data = await apiPost('/sync/pull', { last_sync_version: lastSyncVersion ?? null })
    if (data.bundle) await applySyncBundle(data.bundle)
    return { success: true, hasMore: data.has_more, syncVersion: data.sync_version }
  } catch (error) { return { success: false, hasMore: false, syncVersion: '', error: error instanceof Error ? error.message : 'Unknown error' } }
}

export interface SyncPushResult { success: boolean; processed: string[]; conflicts: Array<{ operationUuid: string; conflictType: string; resolutionHint: string; serverValue?: any; clientValue?: any }>; nextSyncVersion: string }
export async function pushToServer(): Promise<SyncPushResult> {
  if (!isActuallyOnline) return { success: false, processed: [], conflicts: [], nextSyncVersion: '' }
  const pending = await getPendingOperations()
  if (!pending.length) return { success: true, processed: [], conflicts: [], nextSyncVersion: '' }
  try {
    const data = await apiPost('/sync/push', { operations: pending })
    await db.syncQueue.where('operationUuid').anyOf(data.processed).modify({ status: 'ACKNOWLEDGED' })
    for (const conflict of data.conflicts ?? []) await db.syncQueue.where('operationUuid').equals(conflict.operation_uuid).modify({ status: 'CONFLICT', errorMessage: conflict.resolution_hint })
    return { success: true, processed: data.processed ?? [], conflicts: (data.conflicts ?? []).map((c: any) => ({ operationUuid: c.operation_uuid, conflictType: c.conflict_type, resolutionHint: c.resolution_hint, serverValue: c.server_value, clientValue: c.client_value })), nextSyncVersion: data.next_sync_version ?? '' }
  } catch (error) {
    await db.syncQueue.where('status').equals('PENDING').modify((op) => { op.retryCount += 1; if (op.retryCount >= SYNC_CONFIG.MAX_RETRIES) { op.status = 'FAILED'; op.errorMessage = error instanceof Error ? error.message : 'Max retries exceeded' } })
    return { success: false, processed: [], conflicts: [], nextSyncVersion: '' }
  }
}
export const pushOperations = pushToServer

export async function validateMonotonicProgress(unitId: number, boqItemId: number, newPct: number): Promise<{ valid: boolean; currentPct: number; error?: string }> {
  const existing = await db.boqProgress.where('[unitId+boqItemId]').equals([unitId, boqItemId]).first()
  const currentPct = existing?.completionPct ?? 0
  if (newPct < currentPct) return { valid: false, currentPct, error: `Progress cannot decrease from ${currentPct}% to ${newPct}%. Use Rework Flag with justification.` }
  return { valid: true, currentPct }
}

// ─────────────────────────────────────────
// EXECUTION EVENT PIPELINE
// ─────────────────────────────────────────
export interface EventIntentInput {
  entityType: 'BOQ_ITEM'; entityId: string; eventClass: LocalEventIntent['eventClass']; eventType: LocalEventIntent['eventType']; metricType: LocalEventIntent['metricType']; value: Record<string, unknown>; unitOfMeasure?: string; occurredAt?: string; expectedVersion: number; reason?: string; notes?: string; transactionGroupId?: string
}
export interface EventResponse { event_id: string; sync_uuid: string; new_version: number; status: 'PROCESSED'; recorded_at: string }
export interface EventConflict { sync_uuid: string; expected_version: number; actual_version: number; current_state: Record<string, unknown>; resolution_options: string[] }
export interface EventBatchResponse { succeeded: EventResponse[]; conflicts: EventConflict[]; failed: Array<{ sync_uuid?: string; error: string }> }

export async function enqueueExecutionEvent(input: EventIntentInput): Promise<string> {
  const syncUuid = uuidv4()
  await db.eventQueue.put({ syncUuid, entityType: input.entityType, entityId: input.entityId, eventClass: input.eventClass, eventType: input.eventType, metricType: input.metricType, value: input.value, unitOfMeasure: input.unitOfMeasure, occurredAt: input.occurredAt ?? new Date().toISOString(), expectedVersion: input.expectedVersion, reason: input.reason, notes: input.notes, transactionGroupId: input.transactionGroupId, status: 'PENDING', retryCount: 0, createdAt: new Date().toISOString() })
  return syncUuid
}

export async function getPendingEventCount(): Promise<number> { return db.eventQueue.where('status').equals('PENDING').count() }

export async function pushExecutionEvents(limit = 100): Promise<EventBatchResponse> {
  const pending = await db.eventQueue.where('status').equals('PENDING').limit(limit).toArray()
  if (!pending.length) return { succeeded: [], conflicts: [], failed: [] }
  try {
    const data = await apiPost<EventBatchResponse>('/execution/events', { transaction_group_id: uuidv4(), events: pending.map((event) => ({ sync_uuid: event.syncUuid, entity_type: event.entityType, entity_id: event.entityId, event_class: event.eventClass, event_type: event.eventType, metric_type: event.metricType, value: event.value, unit_of_measure: event.unitOfMeasure, occurred_at: event.occurredAt, expected_version: event.expectedVersion, reason: event.reason, notes: event.notes })) })
    for (const event of pending) {
      const success = data.succeeded.find((x) => x.sync_uuid === event.syncUuid)
      const conflict = data.conflicts.find((x) => x.sync_uuid === event.syncUuid)
      const failure = (data.failed ?? []).find((x) => x.sync_uuid === event.syncUuid)
      if (success) {
        await db.eventQueue.update(event.syncUuid, { status: 'ACKNOWLEDGED', errorMessage: undefined })
        const boqItemId = Number(event.entityId)
        const rows = await db.boqProgress.where('boqItemId').equals(boqItemId).toArray()
        for (const row of rows) await db.boqProgress.put({ ...row, stateVersion: success.new_version, lastEventId: success.event_id, pendingSync: false })
      } else if (conflict) {
        await db.eventQueue.update(event.syncUuid, { status: 'CONFLICT', errorMessage: `Version conflict: expected ${conflict.expected_version}, actual ${conflict.actual_version}` })
      } else if (failure) {
        await db.eventQueue.update(event.syncUuid, { status: event.retryCount + 1 >= SYNC_CONFIG.MAX_RETRIES ? 'FAILED' : 'PENDING', retryCount: event.retryCount + 1, errorMessage: failure.error })
      }
    }
    return data
  } catch (error) {
    for (const event of pending) await db.eventQueue.update(event.syncUuid, { status: event.retryCount + 1 >= SYNC_CONFIG.MAX_RETRIES ? 'FAILED' : 'PENDING', retryCount: event.retryCount + 1, errorMessage: error instanceof Error ? error.message : 'Event push failed' })
    throw error
  }
}

export async function retryExecutionEvent(syncUuid: string, expectedVersion: number): Promise<void> { await db.eventQueue.update(syncUuid, { status: 'PENDING', expectedVersion, errorMessage: undefined }) }
