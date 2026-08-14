import { useAuthStore } from './auth-store'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

async function request<T>(path: string, options: RequestInit = {}): Promise<{ data?: T; error?: string }> {
  const send = () => fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(useAuthStore.getState().tokens?.accessToken ? { Authorization: `Bearer ${useAuthStore.getState().tokens!.accessToken}` } : {}), ...(options.headers || {}) },
  })
  try {
    let res = await send()
    if (res.status === 401) {
      await useAuthStore.getState().refreshAccessToken()
      res = await send()
    }
    if (!res.ok) { const body = await res.json().catch(() => ({})); return { error: body.detail || body.error || `HTTP ${res.status}` } }
    return { data: await res.json() }
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
}

export async function getOrgSummary() { return request<any>('/reporting/summary') }
export async function getProjectProgress() { return request<any>('/reporting/project-progress') }
export async function getWorkOrderSummary() { return request<any>('/reporting/work-orders') }
export async function getProjectDashboard(projectId: string) { return request<any>(`/reporting/dashboard/${encodeURIComponent(projectId)}`) }
export async function getExecutionEvents(params: { page?: number; page_size?: number; event_type?: string; unit_id?: string; boq_item_id?: string } = {}) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)) })
  return request<any>(`/execution/events/history?${q.toString()}`)
}

export async function downloadIPC(format: 'csv' | 'xlsx' = 'xlsx', includeHolds = true) {
  const send = () => fetch(`${API_BASE}/reporting/ipc`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(useAuthStore.getState().tokens?.accessToken ? { Authorization: `Bearer ${useAuthStore.getState().tokens!.accessToken}` } : {}) }, body: JSON.stringify({ format, include_holds: includeHolds }) })
  let res = await send()
  if (res.status === 401) { await useAuthStore.getState().refreshAccessToken(); res = await send() }
  if (!res.ok) throw new Error(`IPC export failed: HTTP ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `FieldOps-IPC.${format}`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}
