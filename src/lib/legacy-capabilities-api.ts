"use client"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

function token(): string | null {
  try {
    const raw = localStorage.getItem('fieldops-auth')
    return raw ? JSON.parse(raw)?.state?.tokens?.accessToken || null : null
  } catch { return null }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(options.headers || {}) },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail || `HTTP ${response.status}`)
  }
  return response.json()
}

export interface DiaryEntry {
  id: string; org_id: number; project_id: number; diary_date: string; weather: string | null
  workforce: Record<string, unknown>; equipment: string[]; visits_total: number; visits_accepted: number
  observations: string | null; gps_tag: Record<string, unknown> | null; attachments: string[]
  created_by: number; created_at: string; updated_at: string
}

export async function listDiary(projectId?: string) {
  return request<{ items: DiaryEntry[]; total: number }>(`/field-diary${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`)
}

export async function saveDiary(payload: Omit<DiaryEntry, 'id'|'org_id'|'created_by'|'created_at'|'updated_at'>) {
  return request<DiaryEntry>('/field-diary', { method: 'POST', body: JSON.stringify(payload) })
}

export async function getReportingSummary() {
  return request<any>('/reporting/summary')
}
export async function getProjectProgress() {
  return request<any>('/reporting/project-progress')
}
export async function getWorkOrderSummary() {
  return request<any>('/reporting/work-orders')
}

export async function downloadIPC(format: 'csv'|'xlsx' = 'xlsx') {
  const response = await fetch(`${API_BASE}/reporting/ipc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
    body: JSON.stringify({ format, include_holds: true }),
  })
  if (!response.ok) throw new Error(`IPC export failed: HTTP ${response.status}`)
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') || ''
  const match = disposition.match(/filename=([^;]+)/i)
  const filename = match?.[1]?.replaceAll('"', '') || `FieldOps-IPC.${format}`
  return { blob, filename }
}
