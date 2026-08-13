/** FieldOps V4.0 — Offline Database Schema */
import Dexie, { type Table } from 'dexie'

export interface LocalProject {
  id: number; orgId: number; name: string; code: string
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'
  location?: { latitude: number; longitude: number; governorate: string }
  startDate?: string; endDate?: string; totalUnits?: number; completionPct?: number
  lastSyncedAt: string; isActive: boolean
}
export interface LocalUnit {
  id: number; projectId: number
  unitType: 'LATRINE' | 'SCHOOL' | 'BOREHOLE' | 'SHELTER' | 'ROAD'
  unitCode: string
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED'
  beneficiaryCount?: number; gpsCoordinates?: { lat: number; lng: number }
  lastActivity: string; lastSyncedAt: string
}
export interface LocalBoQProgress {
  unitId: number; boqItemId: number; completionPct: number
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'REWORK_REQUIRED'
  measuredQuantity?: number; reworkFlag: boolean; reworkReason?: string
  reworkAuthorizedBy?: number; lastUpdated: string; pendingSync: boolean
  stateVersion: number; lastEventId?: string
}
export interface LocalRemark {
  id: string; unitId: number; templateId?: number; customIssue?: string
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'OBSERVATION'
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED'
  photos: string[]; gpsTag?: { lat: number; lng: number; accuracy: number }
  createdBy: number; createdAt: string; resolvedAt?: string; pendingSync: boolean
}
export interface LocalRemarkTemplate {
  id: number; orgId: number
  category: 'STRUCTURAL' | 'ELECTRICAL' | 'PLUMBING' | 'SAFETY' | 'FINISHING'
  issue: string; severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'OBSERVATION'
  recommendedAction: string; autoHold: boolean
}
export interface SyncOperation {
  operationUuid: string; operationType: 'CREATE' | 'UPDATE' | 'DELETE'
  entityType: 'WORK_ORDER' | 'UNIT_PROGRESS' | 'REMARK' | 'DAILY_LOG'
  entityId: string; payload: Record<string, unknown>; deviceTimestamp: string
  serverTimestamp?: string
  status: 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'FAILED' | 'CONFLICT'
  retryCount: number; errorMessage?: string; createdAt?: string
}
export interface LocalEventIntent {
  syncUuid: string; entityType: 'BOQ_ITEM'; entityId: string
  eventClass: 'PROGRESS' | 'QUALITY' | 'GOVERNANCE' | 'CORRECTION'
  eventType: 'DELTA_ADD' | 'SNAPSHOT_SET' | 'DATA_CORRECTION' | 'REWORK' | 'STATUS_CHANGE'
  metricType: 'PERCENTAGE' | 'QUANTITY' | 'COUNT'
  value: Record<string, unknown>; unitOfMeasure?: string; occurredAt: string
  expectedVersion: number; reason?: string; notes?: string
  transactionGroupId?: string; status: 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'CONFLICT' | 'FAILED'
  retryCount: number; errorMessage?: string; createdAt: string
}
export interface LocalDecision {
  id: number; unitId: number; boqItemId: number
  decision: 'APPROVE' | 'APPROVE_WITH_NOTE' | 'HOLD' | 'STOP' | 'REWORK'
  paymentPct: number; flag: string; matchedRule: string; reason: string
  policyVersion: number
  override?: { overriddenBy: number; justification: string; overriddenAt: string }
  createdAt: string
}

export class FieldOpsDatabase extends Dexie {
  projects!: Table<LocalProject, number>; units!: Table<LocalUnit, number>
  boqProgress!: Table<LocalBoQProgress, [number, number]>; remarks!: Table<LocalRemark, string>
  remarkTemplates!: Table<LocalRemarkTemplate, number>; syncQueue!: Table<SyncOperation, string>
  eventQueue!: Table<LocalEventIntent, string>; decisions!: Table<LocalDecision, number>

  constructor() {
    super('FieldOpsV4')
    this.version(1).stores({
      projects: 'id, orgId, status, isActive, lastSyncedAt',
      units: 'id, projectId, unitType, status, lastActivity, [projectId+status]',
      boqProgress: '[unitId+boqItemId], unitId, boqItemId, pendingSync, lastUpdated',
      remarks: 'id, unitId, severity, status, pendingSync, createdAt',
      remarkTemplates: 'id, orgId, category, severity',
      syncQueue: 'operationUuid, status, entityType, [status+retryCount]',
      decisions: 'id, unitId, boqItemId, decision, createdAt',
    })
    this.version(2).stores({
      projects: 'id, orgId, status, isActive, lastSyncedAt',
      units: 'id, projectId, unitType, status, lastActivity, [projectId+status]',
      boqProgress: '[unitId+boqItemId], unitId, boqItemId, pendingSync, lastUpdated',
      remarks: 'id, unitId, severity, status, pendingSync, createdAt',
      remarkTemplates: 'id, orgId, category, severity',
      syncQueue: 'operationUuid, status, entityType, [status+retryCount]',
      eventQueue: 'syncUuid, status, entityType, entityId, [status+retryCount], createdAt',
      decisions: 'id, unitId, boqItemId, decision, createdAt',
    })
  }
}
export const db = new FieldOpsDatabase()

export async function loadActiveProjects(projectIds: number[]): Promise<void> {
  await db.projects.where('id').noneOf(projectIds).modify({ isActive: false })
  await db.projects.where('id').anyOf(projectIds).modify({ isActive: true })
}
export async function getActiveUnits(): Promise<LocalUnit[]> {
  const activeProjectIds = await db.projects.where('isActive').equals(1).primaryKeys()
  return db.units.where('projectId').anyOf(activeProjectIds).toArray()
}
export async function getPendingSyncCount(): Promise<number> {
  return db.syncQueue.where('status').equals('PENDING').count()
}
export async function getPendingEventCount(): Promise<number> {
  return db.eventQueue.where('status').equals('PENDING').count()
}
