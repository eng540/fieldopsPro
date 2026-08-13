import { v4 as uuidv4 } from 'uuid'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1').replace(/\/+$/, '')

export interface ExecutionEventIntent {
  sync_uuid: string
  entity_type: 'BOQ_ITEM'
  entity_id: string
  unit_id: number
  boq_item_id: number
  event_class: 'PROGRESS'
  event_type: 'DELTA_ADD' | 'REWORK'
  metric_type: 'PERCENTAGE'
  value: number
  occurred_at: string
  expected_version: number
  transaction_group_id?: string
  reason?: string
  notes?: string
}

export interface ExecutionEventResult {
  event_id: string
  sync_uuid: string
  transaction_group_id?: string | null
  state_version: number
  current_state: Record<string, unknown>
}

export interface ExecutionEventsResponse {
  results: ExecutionEventResult[]
}

export function createProgressIntent(input: Omit<ExecutionEventIntent, 'sync_uuid' | 'occurred_at'>): ExecutionEventIntent {
  return { ...input, sync_uuid: uuidv4(), occurred_at: new Date().toISOString() }
}

export async function submitExecutionEvents(events: ExecutionEventIntent[]): Promise<ExecutionEventsResponse> {
  if (!events.length) return { results: [] }
  const token = typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem('fieldops-auth') || '{}')?.state?.tokens?.accessToken
    : null

  const response = await fetch(`${API_BASE}/execution/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ events }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`)
  return data as ExecutionEventsResponse
}
