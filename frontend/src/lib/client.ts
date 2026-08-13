/** API Client — FieldOps V4.0 */

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '')
export const API_BASE = RAW_API_BASE.endsWith('/api/v1') ? RAW_API_BASE : `${RAW_API_BASE}/api/v1`

let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  const { useAuthStore } = await import('../stores/authStore')
  const store = useAuthStore.getState()
  const refreshToken = (store as any).refreshToken
  if (!refreshToken) throw new Error('No refresh token available')

  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
  if (!response.ok) {
    store.logout()
    throw new Error('Refresh failed')
  }
  const data = await response.json()
  useAuthStore.setState({
    accessToken: data.access_token,
    ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
  })
  return data.access_token
}

async function getRefreshedToken(): Promise<string> {
  if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null })
  return refreshPromise
}

interface ApiClientOptions extends RequestInit { skipAuth?: boolean }

export async function apiClient<T = any>(endpoint: string, options: ApiClientOptions = {}): Promise<T> {
  const { skipAuth, headers: customHeaders, ...restOptions } = options
  const { useAuthStore } = await import('../stores/authStore')
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`

  const makeRequest = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(customHeaders as Record<string, string>),
    }
    if (token && !skipAuth) headers.Authorization = `Bearer ${token}`
    return fetch(`${API_BASE}${normalizedEndpoint}`, { ...restOptions, headers })
  }

  let response = await makeRequest(useAuthStore.getState().accessToken)
  if (response.status === 401 && !skipAuth) {
    try { response = await makeRequest(await getRefreshedToken()) }
    catch { throw new Error('Session expired. Please log in again.') }
  }

  if (!response.ok) {
    const body = await response.text()
    let detail = body
    try {
      const parsed = JSON.parse(body)
      detail = parsed.detail || parsed.message || body
    } catch { /* raw body */ }
    throw new Error(`API ${response.status}: ${detail}`)
  }

  const text = await response.text()
  return text ? JSON.parse(text) as T : undefined as T
}

export function apiGet<T = any>(endpoint: string, options?: ApiClientOptions) {
  return apiClient<T>(endpoint, { ...options, method: 'GET' })
}
export function apiPost<T = any>(endpoint: string, body?: unknown, options?: ApiClientOptions) {
  return apiClient<T>(endpoint, { ...options, method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
}
export function apiPatch<T = any>(endpoint: string, body?: unknown, options?: ApiClientOptions) {
  return apiClient<T>(endpoint, { ...options, method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })
}
export function apiDelete<T = any>(endpoint: string, options?: ApiClientOptions) {
  return apiClient<T>(endpoint, { ...options, method: 'DELETE' })
}
