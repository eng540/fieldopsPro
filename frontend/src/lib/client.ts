/**
 * API Client — FieldOps V4.0
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

let refreshPromise: Promise<string> | null = null

async function refreshAccessToken(): Promise<string> {
  const { useAuthStore } = await import('../stores/authStore')
  const store = useAuthStore.getState()
  const refreshToken = store.refreshToken
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
  useAuthStore.setState({ accessToken: data.access_token })
  return data.access_token
}

async function getRefreshedToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

interface ApiClientOptions extends RequestInit {
  skipAuth?: boolean
}

async function baseApiClient<T = any>(endpoint: string, options: ApiClientOptions = {}): Promise<Response> {
  const { skipAuth, headers: customHeaders, ...restOptions } = options
  const { useAuthStore } = await import('../stores/authStore')

  const makeRequest = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(customHeaders as Record<string, string>),
    }
    if (token && !skipAuth) headers['Authorization'] = `Bearer ${token}`
    return fetch(`${API_BASE}${endpoint}`, { ...restOptions, headers })
  }

  let token = useAuthStore.getState().accessToken
  let response = await makeRequest(token)

  if (response.status === 401 && !skipAuth) {
    try {
      const newToken = await getRefreshedToken()
      response = await makeRequest(newToken)
    } catch {
      throw new Error('Session expired. Please log in again.')
    }
  }

  if (!response.ok) {
    const body = await response.text()
    let detail = body
    try { detail = JSON.parse(body).detail || body } catch {}
    throw new Error(`API ${response.status}: ${detail}`)
  }

  return response
}

export const apiClient = {
  get: async (endpoint: string, options?: ApiClientOptions) => {
    const res = await baseApiClient(endpoint, { ...options, method: 'GET' })
    return res
  },
  post: async (endpoint: string, body?: any, options?: ApiClientOptions) => {
    const res = await baseApiClient(endpoint, { ...options, method: 'POST', body: body ? JSON.stringify(body) : undefined })
    return res
  },
  patch: async (endpoint: string, body?: any, options?: ApiClientOptions) => {
    const res = await baseApiClient(endpoint, { ...options, method: 'PATCH', body: body ? JSON.stringify(body) : undefined })
    return res
  },
  delete: async (endpoint: string, options?: ApiClientOptions) => {
    const res = await baseApiClient(endpoint, { ...options, method: 'DELETE' })
    return res
  }
}