import { addToSyncQueue } from './offline-db'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

function token(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('fieldops-auth')
    return raw ? JSON.parse(raw)?.state?.tokens?.accessToken || null : null
  } catch { return null }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const t = token()
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(options.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.detail || body.error || `HTTP ${res.status}`)
  return body as T
}

export interface WorkOrder {
  id: number; org_id: number; project_id: number; unit_id: number | null
  title: string; description: string | null; wo_type: string; priority: string
  status: string; completion_pct: number; rework_flag: boolean
  rework_reason: string | null; rework_authorized_by: number | null
  created_by: number; server_timestamp: string; created_at: string; updated_at: string
}

export interface WorkOrderPage { items: WorkOrder[]; total: number; page: number; page_size: number; has_more?: boolean }

export async function listWorkOrders(projectId: string | number, page = 1, pageSize = 100): Promise<WorkOrderPage> {
  return request<WorkOrderPage>(`/execution/work-orders?project_id=${projectId}&page=${page}&page_size=${pageSize}`)
}

export async function createWorkOrder(payload: Record<string, unknown>): Promise<WorkOrder> {
  return request<WorkOrder>('/execution/work-orders', { method: 'POST', body: JSON.stringify(payload) })
}

export async function updateWorkOrder(id: number, payload: Record<string, unknown>): Promise<WorkOrder> {
  return request<WorkOrder>(`/execution/work-orders/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
}

export async function assignWorkOrder(id: number, userId: number, notes?: string): Promise<unknown> {
  return request(`/execution/work-orders/${id}/assign`, { method: 'POST', body: JSON.stringify({ user_id: userId, notes }) })
}

export interface ExecutionState {
  id: number; org_id: number; unit_id: number; boq_item_id: number
  completion_pct: number; status: string; state_version: number
  actual_quantity: number | null; last_event_id: string | null
}

export async function getExecutionState(unitId: number, boqItemId: number): Promise<ExecutionState | null> {
  try { return await request<ExecutionState>(`/execution/state/${unitId}/${boqItemId}`) }
  catch (e) { return null }
}

export async function submitProgressEvent(args: {
  unitId: number; boqItemId: number; expectedVersion: number; completionPct: number
  currentPct: number; reworkReason?: string; occurredAt?: string
}): Promise<unknown> {
  const delta = args.completionPct - args.currentPct
  const rework = delta < 0
  const payload = {
    sync_uuid: crypto.randomUUID(), entity_type: 'BOQ_ITEM', entity_id: String(args.boqItemId),
    unit_id: args.unitId, event_class: 'PROGRESS', event_type: rework ? 'REWORK' : 'DELTA_ADD',
    metric_type: 'PERCENTAGE', value: { pct: Math.abs(delta) },
    occurred_at: args.occurredAt || new Date().toISOString(), expected_version: args.expectedVersion,
    reason: rework ? args.reworkReason : undefined,
  }
  return request('/execution/events', { method: 'POST', body: JSON.stringify({ events: [payload] }) })
}

export async function queueProgressOffline(orgId: string, item: {
  unitId: string; boqItemId: string; completionPct: number; reworkFlag: boolean; reworkReason: string
}) {
  await addToSyncQueue({
    orgId,
    entityType: 'BOQ_PROGRESS',
    entityId: `${item.unitId}:${item.boqItemId}`,
    operationType: 'UPDATE',
    payload: JSON.stringify({ ...item, unit_id: Number(item.unitId), boq_item_id: Number(item.boqItemId) }),
  })
}
