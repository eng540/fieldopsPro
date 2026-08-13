const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

function token(): string | null {
  if (typeof window === 'undefined') return null
  try { return JSON.parse(localStorage.getItem('fieldops-auth') || '{}')?.state?.tokens?.accessToken || null } catch { return null }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(options.headers || {}) } })
    if (!res.ok) { const body = await res.json().catch(() => ({})); return { error: body.detail || `HTTP ${res.status}` } }
    return { data: await res.json() }
  } catch (e) { return { error: String(e) } }
}

export async function getOrgSummary() { return request<any>('/reporting/summary') }
export async function getProjectProgress() { return request<any>('/reporting/project-progress') }
export async function getWorkOrderSummary() { return request<any>('/reporting/work-orders') }
export async function getProjectDashboard(projectId: string) { return request<any>(`/reporting/dashboard/${projectId}`) }
export async function getExecutionEvents(params: { page?: number; page_size?: number; event_type?: string; unit_id?: string; boq_item_id?: string } = {}) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)) })
  return request<any>(`/execution/events/history?${q.toString()}`)
}

export async function downloadIPC(format: 'csv' | 'xlsx' = 'xlsx', includeHolds = true) {
  const res = await fetch(`${API_BASE}/reporting/ipc`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) }, body: JSON.stringify({ format, include_holds: includeHolds }) })
  if (!res.ok) throw new Error(`IPC export failed: HTTP ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `FieldOps-IPC.${format}`
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}
