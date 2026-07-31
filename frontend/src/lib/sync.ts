/**
 * FieldOps V4.0 — Offline-First Sync Engine
 *
 * Constitutional Principles:
 * - Exactly-Once: operation_uuid + processed_operations registry
 * - Server-Reconciled State: Server is absolute truth
 * - Reachability-based: navigator.onLine is insufficient
 * - Monotonic Progress: Client-side validation before push
 */

import { db, type SyncOperation, type LocalBoQProgress, type LocalProject, type LocalUnit, type LocalRemarkTemplate, type LocalDecision } from './db'
import { apiPost } from './client'

const SYNC_CONFIG = {
  BATCH_SIZE: 100,
  MAX_RETRIES: 3,
  HEARTBEAT_INTERVAL_MS: 30000,
  HEARTBEAT_URL: '/health',
} as const

// ─────────────────────────────────────────
// REACHABILITY (Better than navigator.onLine)
// ─────────────────────────────────────────

let isActuallyOnline = navigator.onLine
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

export function startReachabilityMonitoring(): void {
  if (heartbeatTimer) return
  heartbeatTimer = setInterval(async () => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const response = await fetch(SYNC_CONFIG.HEARTBEAT_URL, {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-store',
      })
      clearTimeout(timeout)
      isActuallyOnline = response.ok
    } catch {
      isActuallyOnline = false
    }
  }, SYNC_CONFIG.HEARTBEAT_INTERVAL_MS)
}

export function stopReachabilityMonitoring(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
}

export function getReachability(): boolean { return isActuallyOnline }

// ─────────────────────────────────────────
// SYNC BUNDLE — applySyncBundle()
// Resolves the Pull Blackhole (Sprint-4 M1.1)
// ─────────────────────────────────────────

interface RawBundle {
  projects?:         any[]
  units?:            any[]
  boq_items?:        any[]
  remark_templates?: any[]
  decisions?:        any[]
  work_orders?:      any[]
}

/**
 * Apply a SyncBundle from the server into IndexedDB atomically.
 *
 * Constitutional:
 * - Runs inside a single Dexie transaction (rw) over all tables → Atomic
 * - Server data is authoritative — local rows are replaced, never merged
 * - Null/undefined arrays are skipped gracefully (partial bundles OK)
 * - Type mapping: snake_case API → camelCase LocalX interfaces
 */
export async function applySyncBundle(bundle: RawBundle): Promise<void> {
  if (!bundle) return

  await db.transaction(
    'rw',
    [db.projects, db.units, db.boqProgress, db.remarkTemplates, db.decisions],
    async () => {

      // ── Projects ─────────────────────────────────────────────────────────
      if (bundle.projects?.length) {
        const localProjects: LocalProject[] = bundle.projects.map((p) => ({
          id:           p.id,
          orgId:        p.org_id,
          name:         p.name,
          code:         p.code,
          status:       p.status ?? 'DRAFT',
          location:     p.location_data
            ? { latitude: p.location_data.lat ?? 0, longitude: p.location_data.lng ?? 0, governorate: p.location_data.governorate ?? '' }
            : undefined,
          startDate:    p.start_date ?? undefined,
          endDate:      p.end_date ?? undefined,
          lastSyncedAt: new Date().toISOString(),
          isActive:     p.is_active ?? true,
        }))
        await db.projects.bulkPut(localProjects)
      }

      // ── Units ─────────────────────────────────────────────────────────────
      if (bundle.units?.length) {
        const localUnits: LocalUnit[] = bundle.units.map((u) => ({
          id:                u.id,
          projectId:         u.project_id,
          unitType:          u.unit_type ?? 'SHELTER',
          unitCode:          u.code ?? u.unit_code ?? String(u.id),
          status:            u.status ?? 'PLANNED',
          beneficiaryCount:  u.beneficiary_count ?? undefined,
          gpsCoordinates:    u.gps_tag
            ? { lat: u.gps_tag.lat, lng: u.gps_tag.lng }
            : undefined,
          lastActivity:      u.updated_at ?? new Date().toISOString(),
          lastSyncedAt:      new Date().toISOString(),
        }))
        await db.units.bulkPut(localUnits)
      }

      // ── BOQ Items → boqProgress seed ─────────────────────────────────────
      // boq_items from bundle are definitions, not progress.
      // We upsert progress rows only if they don't already exist locally
      // (to avoid overwriting pending local edits).
      if (bundle.boq_items?.length) {
        for (const item of bundle.boq_items) {
          const unitId    = item.unit_id ?? 0
          const boqItemId = item.id
          const existing  = await db.boqProgress
            .where('[unitId+boqItemId]')
            .equals([unitId, boqItemId])
            .first()

          if (!existing) {
            const seed: LocalBoQProgress = {
              unitId,
              boqItemId,
              completionPct: item.completion_pct ?? 0,
              status:        item.status ?? 'NOT_STARTED',
              measuredQuantity: item.measured_quantity ?? undefined,
              reworkFlag:    false,
              lastUpdated:   item.last_updated ?? new Date().toISOString(),
              pendingSync:   false,
            }
            await db.boqProgress.put(seed)
          } else if (!existing.pendingSync) {
            // Server is authoritative only when no local pending changes
            await db.boqProgress.put({
              ...existing,
              completionPct: item.completion_pct ?? existing.completionPct,
              status:        item.status ?? existing.status,
              lastUpdated:   item.last_updated ?? existing.lastUpdated,
            })
          }
          // If pendingSync=true → keep local version until push succeeds
        }
      }

      // ── Remark Templates ─────────────────────────────────────────────────
      if (bundle.remark_templates?.length) {
        const localTemplates: LocalRemarkTemplate[] = bundle.remark_templates.map((t) => ({
          id:                t.id,
          orgId:             t.org_id,
          category:          t.category,
          issue:             t.issue,
          severity:          t.severity,
          recommendedAction: t.recommended_action ?? '',
          autoHold:          t.auto_hold ?? false,
        }))
        await db.remarkTemplates.bulkPut(localTemplates)
      }

      // ── Governance Decisions ──────────────────────────────────────────────
      if (bundle.decisions?.length) {
        const localDecisions: LocalDecision[] = bundle.decisions.map((d) => ({
          id:            d.id,
          unitId:        d.unit_id,
          boqItemId:     d.boq_item_id ?? 0,
          decision:      d.decision,
          paymentPct:    d.payment_pct ?? 0,
          flag:          d.flag ?? '',
          matchedRule:   d.matched_rule ?? '',
          reason:        d.reason ?? '',
          policyVersion: d.policy_version ?? 1,
          override:      d.is_overridden
            ? { overriddenBy: d.triggered_by, justification: '', overriddenAt: d.created_at }
            : undefined,
          createdAt:     d.created_at,
        }))
        await db.decisions.bulkPut(localDecisions)
      }
    }
  )
}

// ─────────────────────────────────────────
// SYNC QUEUE MANAGEMENT
// ─────────────────────────────────────────

export async function enqueueOperation(
  operation: Omit<SyncOperation, 'status' | 'retryCount'>
): Promise<void> {
  await db.syncQueue.put({ ...operation, status: 'PENDING', retryCount: 0 })
}

export async function getPendingOperations(): Promise<SyncOperation[]> {
  return db.syncQueue
    .where('status').equals('PENDING')
    .limit(SYNC_CONFIG.BATCH_SIZE)
    .toArray()
}

// ─────────────────────────────────────────
// PULL (Download from Server)
// ─────────────────────────────────────────

export interface SyncPullResult {
  success: boolean
  hasMore: boolean
  syncVersion: string
  error?: string
}

export async function pullFromServer(lastSyncVersion?: string | null): Promise<SyncPullResult> {
  if (!isActuallyOnline) {
    return { success: false, hasMore: false, syncVersion: '', error: 'Offline' }
  }

  try {
    const data = await apiPost('/sync/pull', {
      last_sync_version: lastSyncVersion ?? null,
    })

    // ✅ FIXED (Sprint-4 M1.1): Apply bundle to IndexedDB atomically
    if (data.bundle) {
      await applySyncBundle(data.bundle)
    }

    return { success: true, hasMore: data.has_more, syncVersion: data.sync_version }
  } catch (error) {
    return {
      success: false,
      hasMore: false,
      syncVersion: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// Alias used by syncStore.ts
export const pushOperations = pushToServer

// ─────────────────────────────────────────
// PUSH (Upload to Server)
// ─────────────────────────────────────────

export interface SyncPushResult {
  success: boolean
  processed: string[]
  conflicts: Array<{ operationUuid: string; conflictType: string; resolutionHint: string; serverValue?: any; clientValue?: any }>
  nextSyncVersion: string
}

export async function pushToServer(): Promise<SyncPushResult> {
  if (!isActuallyOnline) {
    return { success: false, processed: [], conflicts: [], nextSyncVersion: '' }
  }

  const pending = await getPendingOperations()
  if (pending.length === 0) {
    return { success: true, processed: [], conflicts: [], nextSyncVersion: '' }
  }

  try {
    const data = await apiPost('/sync/push', { operations: pending })

    await db.syncQueue
      .where('operationUuid').anyOf(data.processed)
      .modify({ status: 'ACKNOWLEDGED' })

    for (const conflict of data.conflicts ?? []) {
      await db.syncQueue
        .where('operationUuid').equals(conflict.operation_uuid)
        .modify({ status: 'CONFLICT', errorMessage: conflict.resolution_hint })
    }

    return {
      success: true,
      processed: data.processed ?? [],
      conflicts: (data.conflicts ?? []).map((c: any) => ({
        operationUuid:  c.operation_uuid,
        conflictType:   c.conflict_type,
        resolutionHint: c.resolution_hint,
        serverValue:    c.server_value,
        clientValue:    c.client_value,
      })),
      nextSyncVersion: data.next_sync_version ?? '',
    }
  } catch (error) {
    await db.syncQueue
      .where('status').equals('PENDING')
      .modify((op) => {
        op.retryCount += 1
        if (op.retryCount >= SYNC_CONFIG.MAX_RETRIES) {
          op.status = 'FAILED'
          op.errorMessage = error instanceof Error ? error.message : 'Max retries exceeded'
        }
      })
    return { success: false, processed: [], conflicts: [], nextSyncVersion: '' }
  }
}

// ─────────────────────────────────────────
// MONOTONIC PROGRESS VALIDATION (Client-side guard)
// ─────────────────────────────────────────

export async function validateMonotonicProgress(
  unitId: number,
  boqItemId: number,
  newPct: number
): Promise<{ valid: boolean; currentPct: number; error?: string }> {
  const existing = await db.boqProgress
    .where('[unitId+boqItemId]').equals([unitId, boqItemId]).first()
  const currentPct = existing?.completionPct ?? 0
  if (newPct < currentPct) {
    return {
      valid: false,
      currentPct,
      error: `Progress cannot decrease from ${currentPct}% to ${newPct}%. Use Rework Flag with justification.`,
    }
  }
  return { valid: true, currentPct }
}
