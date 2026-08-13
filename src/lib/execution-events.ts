import { v4 as uuidv4 } from 'uuid'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export interface ExecutionEventIntent {
  sync_uuid: string
  entity_type: 'BOQ_ITEM'
  entity_id: string
  event_class: 'PROGRESS'
  event_type: 'DELTA_ADD' | 'REWORK'
  metric_type: 'PERCENTAGE'
  value: { pct: number }
  occurred_at: string
  expected_version: number
  reason?: string
}

export function createProgressIntent(input: Omit<ExecutionEventIntent, 'sync_uuid' | 'occurred_at'>): ExecutionEventIntent {
  return { ...input, sync_uuid: uuidv4(), occurred_at: new Date().toISOString() }
}

export async function submitExecutionEvents(events: ExecutionEventIntent[]) {
  const token = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('fieldops-auth') || '{}')?.state?.tokens?.accessToken : null
  const response = await fetch(`${API_BASE}/execution/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ events }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`)
  return data
}
