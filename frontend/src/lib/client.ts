"""API Client — FieldOps V4.0

HTTP client with automatic Bearer token injection and 401 retry with refresh.

Constitutional (ADR-004):
- Access token stored in memory ONLY (no localStorage/cookies)
- Refresh token in memory (production: HttpOnly cookie)
- 401 responses trigger silent refresh before retry
- On refresh failure, calls logout() to clear state
"""

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

/** Pending requests waiting for a token refresh to complete. */
let refreshPromise: Promise<string> | null = null

/**
 * Attempt to refresh the access token using the refresh token.
 * Returns a new access token or throws if refresh fails.
 */
async function refreshAccessToken(): Promise<string> {
  const { useAuthStore } = await import('../stores/authStore')
  const store = useAuthStore.getState()

  const refreshToken = (store as any).refreshToken
  if (!refreshToken) {
    throw new Error('No refresh token available')
  }

  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })

  if (!response.ok) {
    // Refresh failed — force logout
    store.logout()
    throw new Error('Refresh failed')
  }

  const data = await response.json()
  // Update the store with new access token
  useAuthStore.setState({ accessToken: data.access_token })
  return data.access_token
}

/**
 * Ensure only one refresh request is in-flight at a time.
 * Subsequent 401s while a refresh is pending will await the same promise.
 */
async function getRefreshedToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

/**
 * Typed request options extending the native RequestInit.
 * Allows setting `auth: false` to skip token injection.
 */
interface ApiClientOptions extends RequestInit {
  /** Set to true to skip Authorization header injection. */
  skipAuth?: boolean
}

/**
 * Core fetch wrapper with Bearer token injection and 401 retry logic.
 *
 * Flow:
 * 1. Read accessToken from authStore
 * 2. Inject Authorization: Bearer <token> header
 * 3. Send request
 * 4. If 401, attempt refresh and retry once
 * 5. If refresh fails, logout and propagate error
 */
export async function apiClient<T = any>(
  endpoint: string,
  options: ApiClientOptions = {},
): Promise<T> {
  const { skipAuth, headers: customHeaders, ...restOptions } = options

  const { useAuthStore } = await import('../stores/authStore')

  const makeRequest = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(customHeaders as Record<string, string>),
    }

    if (token && !skipAuth) {
      headers['Authorization'] = `Bearer ${token}`
    }

    return fetch(`${API_BASE}${endpoint}`, {
      ...restOptions,
      headers,
    })
  }

  // Initial request with current token
  const token = useAuthStore.getState().accessToken
  let response = await makeRequest(token)

  // Handle 401 — attempt silent refresh + retry once
  if (response.status === 401 && !skipAuth) {
    try {
      const newToken = await getRefreshedToken()
      response = await makeRequest(newToken)
    } catch {
      // Refresh failed — logout already called
      throw new Error('Session expired. Please log in again.')
    }
  }

  if (!response.ok) {
    const body = await response.text()
    let detail = body
    try {
      detail = JSON.parse(body).detail || body
    } catch {
      // use raw body text
    }
    throw new Error(`API ${response.status}: ${detail}`)
  }

  // Handle empty responses (e.g., 204 No Content)
  const text = await response.text()
  if (!text) {
    return undefined as T
  }

  return JSON.parse(text) as T
}

/** Convenience GET helper. */
export function apiGet<T = any>(endpoint: string, options?: ApiClientOptions) {
  return apiClient<T>(endpoint, { ...options, method: 'GET' })
}

/** Convenience POST helper. */
export function apiPost<T = any>(endpoint: string, body?: unknown, options?: ApiClientOptions) {
  return apiClient<T>(endpoint, {
    ...options,
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  })
}

/** Convenience PATCH helper. */
export function apiPatch<T = any>(endpoint: string, body?: unknown, options?: ApiClientOptions) {
  return apiClient<T>(endpoint, {
    ...options,
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  })
}

/** Convenience DELETE helper. */
export function apiDelete<T = any>(endpoint: string, options?: ApiClientOptions) {
  return apiClient<T>(endpoint, { ...options, method: 'DELETE' })
}
