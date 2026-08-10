// FieldOps V4 — Offline-First IndexedDB Schema
// Dexie.js Database Layer for Sprint 5

import Dexie, { type EntityTable } from 'dexie'

// ============================================================
// Local Data Types
// ============================================================

export interface LocalProject {
  id: string
  orgId: string
  name: string
  code: string
  status: string
  location: string | null
  totalUnits: number
  completionPct: number
  isActive: boolean
  lastSyncedAt: number
}

export interface LocalUnit {
  id: string
  orgId: string
  projectId: string
  name: string
  code: string
  unitType: string
  floor: string | null
  areaSqm: number | null
  status: string
  completionPct: number
  lastSyncedAt: number
}

export interface LocalBoqItem {
  id: string
  orgId: string
  unitId: string
  trade: string
  description: string
  quantity: number
  unitOfMeasure: string
  completionPct: number
  lastSyncedAt: number
}

export interface LocalBoqProgress {
  id: string
  orgId: string
  unitId: string
  boqItemId: string
  completionPct: number
  status: string
  measuredQuantity: number | null
  reworkFlag: boolean
  reworkReason: string | null
  reworkAuthorizedBy: string | null
  updatedBy: string | null
  pendingSync: boolean
  lastSyncedAt: number
}

export interface LocalRemark {
  id: string
  orgId: string
  unitId: string
  workOrderId: string | null
  templateId: string | null
  customIssue: string | null
  severity: string
  status: string
  photos: string // JSON array
  gpsTag: string | null // JSON
  resolutionNotes: string | null
  createdBy: string | null
  resolvedAt: string | null
  pendingSync: boolean
  lastSyncedAt: number
}

export interface LocalPhoto {
  id: string
  remarkId: string
  blob: Blob
  base64: string
  compressed: boolean
  uploadedAt: string | null
  pendingSync: boolean
  createdAt: number
}

export interface SyncQueueItem {
  id?: number
  operationUuid: string
  entityType: 'project' | 'unit' | 'boqProgress' | 'remark' | 'photo' | 'user' | 'dictionary'
  operationType: 'CREATE' | 'UPDATE' | 'DELETE' | 'BULK_PROGRESS'
  endpoint: string
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  payload: string // JSON
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CONFLICT'
  retryCount: number
  maxRetries: number
  lastError: string | null
  /** Server data from 207 Multi-Status conflict response (JSON string) */
  serverData: string | null
  createdAt: number
  processedAt: number | null
}

export interface LocalUser {
  id: string
  orgId: string
  email: string
  name: string
  isActive: boolean
  assignments: string // JSON
  lastSyncedAt: number
}

export interface LocalAuditLog {
  id: string
  orgId: string
  userId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  details: string // JSON
  createdAt: string
  lastSyncedAt: number
}

export interface LocalDictionary {
  id: string
  orgId: string
  name: string
  category: string
  description: string | null
  isActive: boolean
  items: string // JSON
  lastSyncedAt: number
}

// ============================================================
// Database Definition
// ============================================================

class FieldOpsDatabase extends Dexie {
  projects!: EntityTable<LocalProject, 'id'>
  units!: EntityTable<LocalUnit, 'id'>
  boqItems!: EntityTable<LocalBoqItem, 'id'>
  boqProgress!: EntityTable<LocalBoqProgress, 'id'>
  remarks!: EntityTable<LocalRemark, 'id'>
  photos!: EntityTable<LocalPhoto, 'id'>
  syncQueue!: EntityTable<SyncQueueItem, 'id'>
  users!: EntityTable<LocalUser, 'id'>
  auditLogs!: EntityTable<LocalAuditLog, 'id'>
  dictionaries!: EntityTable<LocalDictionary, 'id'>

  constructor() {
    super('FieldOpsV4')

    this.version(1).stores({
      projects: 'id, orgId, status, isActive, lastSyncedAt',
      units: 'id, orgId, projectId, unitType, status, lastSyncedAt',
      boqItems: 'id, orgId, unitId, trade, lastSyncedAt',
      boqProgress: 'id, orgId, unitId, boqItemId, pendingSync, lastSyncedAt, [unitId+boqItemId]',
      remarks: 'id, orgId, unitId, severity, status, pendingSync, lastSyncedAt',
      photos: 'id, remarkId, pendingSync, createdAt',
      syncQueue: '++id, operationUuid, entityType, status, createdAt, [entityType+status]',
      users: 'id, orgId, email, lastSyncedAt',
      auditLogs: 'id, orgId, action, resourceType, lastSyncedAt',
      dictionaries: 'id, orgId, category, isActive, lastSyncedAt',
    })
  }
}

export const db = new FieldOpsDatabase()

// ============================================================
// Sync Queue Helpers
// ============================================================

export async function addToSyncQueue(item: Omit<SyncQueueItem, 'id' | 'createdAt' | 'processedAt' | 'status' | 'retryCount' | 'lastError'>): Promise<number> {
  return db.syncQueue.add({
    ...item,
    status: 'PENDING',
    retryCount: 0,
    maxRetries: item.maxRetries || 3,
    lastError: null,
    createdAt: Date.now(),
    processedAt: null,
  })
}

export async function getPendingSyncCount(): Promise<number> {
  return db.syncQueue.where('status').equals('PENDING').count()
}

export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  return db.syncQueue.where('status').equals('PENDING').toArray()
}

export async function updateSyncQueueItem(id: number, updates: Partial<SyncQueueItem>): Promise<void> {
  await db.syncQueue.update(id, updates)
}

export async function clearCompletedSyncItems(): Promise<void> {
  await db.syncQueue.where('status').anyOf(['COMPLETED', 'FAILED']).delete()
}

// ============================================================
// Data Sync Helpers — Pull from Server to Local
// ============================================================

export async function syncProjectsFromServer(projects: Array<{
  id: string; orgId: string; name: string; code: string; status: string;
  location: string | null; totalUnits: number; completionPct: number; isActive: boolean;
  units: Array<{
    id: string; orgId: string; projectId: string; name: string; code: string;
    unitType: string; floor: string | null; areaSqm: number | null; status: string;
    completionPct: number; boqItems: Array<{
      id: string; orgId: string; unitId: string; trade: string; description: string;
      quantity: number; unitOfMeasure: string; completionPct: number;
    }>;
  }>;
}>): Promise<void> {
  const now = Date.now()

  await db.transaction('rw', [db.projects, db.units, db.boqItems], async () => {
    for (const project of projects) {
      await db.projects.put({
        ...project,
        lastSyncedAt: now,
      })

      for (const unit of project.units || []) {
        await db.units.put({
          ...unit,
          lastSyncedAt: now,
        })

        for (const boq of unit.boqItems || []) {
          await db.boqItems.put({
            ...boq,
            lastSyncedAt: now,
          })
        }
      }
    }
  })
}

export async function syncRemarksFromServer(remarks: Array<{
  id: string; orgId: string; unitId: string; unit: { id: string; name: string; code: string };
  workOrderId: string | null; templateId: string | null; customIssue: string | null;
  severity: string; status: string; photos: string[]; gpsTag: Record<string, unknown> | null;
  resolutionNotes: string | null; createdBy: string | null; resolvedAt: string | null;
  createdAt: string; updatedAt: string;
}>): Promise<void> {
  const now = Date.now()

  await db.transaction('rw', db.remarks, async () => {
    for (const remark of remarks) {
      await db.remarks.put({
        id: remark.id,
        orgId: remark.orgId,
        unitId: remark.unitId,
        workOrderId: remark.workOrderId,
        templateId: remark.templateId,
        customIssue: remark.customIssue,
        severity: remark.severity,
        status: remark.status,
        photos: JSON.stringify(remark.photos || []),
        gpsTag: remark.gpsTag ? JSON.stringify(remark.gpsTag) : null,
        resolutionNotes: remark.resolutionNotes,
        createdBy: remark.createdBy,
        resolvedAt: remark.resolvedAt,
        pendingSync: false,
        lastSyncedAt: now,
      })
    }
  })
}

export async function syncUsersFromServer(users: Array<{
  id: string; orgId: string; email: string; name: string; isActive: boolean;
  assignments: Array<{ id: string; projectId: string; project: { id: string; name: string; code: string }; role: { id: string; name: string } }>;
}>): Promise<void> {
  const now = Date.now()

  await db.transaction('rw', db.users, async () => {
    for (const user of users) {
      await db.users.put({
        id: user.id,
        orgId: user.orgId,
        email: user.email,
        name: user.name,
        isActive: user.isActive,
        assignments: JSON.stringify(user.assignments || []),
        lastSyncedAt: now,
      })
    }
  })
}

export async function syncAuditLogsFromServer(logs: Array<{
  id: string; user: { name: string; email: string } | null; action: string;
  resourceType: string; resourceId: string | null; details: Record<string, unknown>;
  createdAt: string;
}>): Promise<void> {
  const now = Date.now()

  await db.transaction('rw', db.auditLogs, async () => {
    for (const log of logs) {
      await db.auditLogs.put({
        id: log.id,
        orgId: '',
        userId: log.user ? (log.user as unknown as { id: string }).id || null : null,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        details: JSON.stringify(log.details || {}),
        createdAt: log.createdAt,
        lastSyncedAt: now,
      })
    }
  })
}

export async function syncDictionariesFromServer(dictionaries: Array<{
  id: string; orgId: string; name: string; category: string; description: string | null;
  isActive: boolean; items: Array<{ id: string; trade: string; description: string; quantity: number; unitOfMeasure: string; sortOrder: number }>;
}>): Promise<void> {
  const now = Date.now()

  await db.transaction('rw', db.dictionaries, async () => {
    for (const dict of dictionaries) {
      await db.dictionaries.put({
        id: dict.id,
        orgId: dict.orgId,
        name: dict.name,
        category: dict.category,
        description: dict.description,
        isActive: dict.isActive,
        items: JSON.stringify(dict.items || []),
        lastSyncedAt: now,
      })
    }
  })
}

// ============================================================
// Photo Storage Helpers
// ============================================================

export async function savePhotoToLocal(remarkId: string, file: File): Promise<string> {
  const photoId = `photo-${Date.now()}-${Math.random().toString(36).substring(7)}`

  // Compress image
  const compressed = await compressImage(file, 0.7, 1200)

  // Save as both Blob and Base64
  await db.photos.put({
    id: photoId,
    remarkId,
    blob: compressed.blob,
    base64: compressed.base64,
    compressed: true,
    uploadedAt: null,
    pendingSync: true,
    createdAt: Date.now(),
  })

  // Add to sync queue
  await addToSyncQueue({
    operationUuid: photoId,
    entityType: 'photo',
    operationType: 'CREATE',
    endpoint: `/quality/remarks/${remarkId}/photos`,
    method: 'POST',
    payload: JSON.stringify({ photoId, remarkId, size: compressed.blob.size }),
    maxRetries: 3,
  })

  return photoId
}

async function compressImage(
  file: File,
  quality: number,
  maxWidth: number
): Promise<{ blob: Blob; base64: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            const base64 = canvas.toDataURL('image/jpeg', quality)
            resolve({ blob: blob!, base64 })
          },
          'image/jpeg',
          quality
        )
      }
      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)
  })
}

export async function getPhotosForRemark(remarkId: string): Promise<LocalPhoto[]> {
  return db.photos.where('remarkId').equals(remarkId).toArray()
}

export async function getPendingPhotos(): Promise<LocalPhoto[]> {
  return db.photos.where('pendingSync').equals(1).toArray()
}

// ============================================================
// Offline-First Progress Updates
// ============================================================

export async function saveProgressOffline(
  orgId: string,
  unitId: string,
  boqItemId: string,
  completionPct: number,
  reworkFlag: boolean = false,
  reworkReason: string | null = null,
  reworkAuthorizedBy: string | null = null
): Promise<void> {
  const progressId = `progress-${unitId}-${boqItemId}`

  // Save locally
  await db.boqProgress.put({
    id: progressId,
    orgId,
    unitId,
    boqItemId,
    completionPct,
    status: completionPct >= 100 ? 'COMPLETED' : completionPct > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
    measuredQuantity: null,
    reworkFlag,
    reworkReason,
    reworkAuthorizedBy,
    updatedBy: 'current-user',
    pendingSync: true,
    lastSyncedAt: Date.now(),
  })

  // Add to sync queue
  await addToSyncQueue({
    operationUuid: `op-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    entityType: 'boqProgress',
    operationType: 'UPDATE',
    endpoint: '/execution/bulk-progress',
    method: 'POST',
    payload: JSON.stringify({
      orgId,
      updates: [{ unitId, boqItemId, completionPct, reworkFlag, reworkReason, reworkAuthorizedBy }],
      updatedBy: 'current-user',
    }),
    maxRetries: 5,
  })
}

export async function saveBulkProgressOffline(
  orgId: string,
  updates: Array<{
    unitId: string; boqItemId: string; completionPct: number;
    reworkFlag: boolean; reworkReason: string;
  }>,
  updatedBy: string
): Promise<void> {
  const now = Date.now()

  await db.transaction('rw', [db.boqProgress, db.syncQueue], async () => {
    for (const update of updates) {
      const progressId = `progress-${update.unitId}-${update.boqItemId}`
      await db.boqProgress.put({
        id: progressId,
        orgId,
        unitId: update.unitId,
        boqItemId: update.boqItemId,
        completionPct: update.completionPct,
        status: update.completionPct >= 100 ? 'COMPLETED' : update.completionPct > 0 ? 'IN_PROGRESS' : 'NOT_STARTED',
        measuredQuantity: null,
        reworkFlag: update.reworkFlag,
        reworkReason: update.reworkReason || null,
        reworkAuthorizedBy: update.reworkFlag ? 'current-user' : null,
        updatedBy,
        pendingSync: true,
        lastSyncedAt: now,
      })
    }

    // Single bulk sync queue item
    await addToSyncQueue({
      operationUuid: `op-${now}-${Math.random().toString(36).substring(7)}`,
      entityType: 'boqProgress',
      operationType: 'BULK_PROGRESS',
      endpoint: '/execution/bulk-progress',
      method: 'POST',
      payload: JSON.stringify({ orgId, updates, updatedBy }),
      maxRetries: 5,
    })
  })
}

// ============================================================
// Offline-First Remark Creation
// ============================================================

export async function saveRemarkOffline(
  orgId: string,
  unitId: string,
  severity: string,
  customIssue: string,
  photos: string[] = [],
  gpsTag: Record<string, unknown> | null = null
): Promise<string> {
  const remarkId = `remark-local-${Date.now()}-${Math.random().toString(36).substring(7)}`
  const now = Date.now()

  await db.remarks.put({
    id: remarkId,
    orgId,
    unitId,
    workOrderId: null,
    templateId: null,
    customIssue,
    severity,
    status: 'OPEN',
    photos: JSON.stringify(photos),
    gpsTag: gpsTag ? JSON.stringify(gpsTag) : null,
    resolutionNotes: null,
    createdBy: 'current-user',
    resolvedAt: null,
    pendingSync: true,
    lastSyncedAt: now,
  })

  await addToSyncQueue({
    operationUuid: `op-${now}-${Math.random().toString(36).substring(7)}`,
    entityType: 'remark',
    operationType: 'CREATE',
    endpoint: '/quality/remarks',
    method: 'POST',
    payload: JSON.stringify({ orgId, unitId, severity, customIssue, photos, gpsTag, createdBy: 'current-user' }),
    maxRetries: 3,
  })

  return remarkId
}

// ============================================================
// Database Stats
// ============================================================

export async function getLocalDatabaseStats(): Promise<{
  projects: number; units: number; boqItems: number;
  boqProgress: number; remarks: number; photos: number;
  pendingSync: number; syncQueue: number;
}> {
  const [projects, units, boqItems, boqProgress, remarks, photos, pendingSync, syncQueue] = await Promise.all([
    db.projects.count(),
    db.units.count(),
    db.boqItems.count(),
    db.boqProgress.count(),
    db.remarks.count(),
    db.photos.count(),
    db.boqProgress.where('pendingSync').equals(1).count(),
    db.syncQueue.where('status').equals('PENDING').count(),
  ])

  return { projects, units, boqItems, boqProgress, remarks, photos, pendingSync, syncQueue }
}

// ============================================================
// Clear All Local Data
// ============================================================

export async function clearLocalDatabase(): Promise<void> {
  await db.transaction('rw', [db.projects, db.units, db.boqItems, db.boqProgress, db.remarks, db.photos, db.syncQueue, db.users, db.auditLogs, db.dictionaries], async () => {
    await Promise.all([
      db.projects.clear(),
      db.units.clear(),
      db.boqItems.clear(),
      db.boqProgress.clear(),
      db.remarks.clear(),
      db.photos.clear(),
      db.syncQueue.clear(),
      db.users.clear(),
      db.auditLogs.clear(),
      db.dictionaries.clear(),
    ])
  })
}
