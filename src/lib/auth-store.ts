// FieldOps V4 — Auth State Management (Zustand)
// Hardened authentication lifecycle for FastAPI /auth/login, /auth/refresh, /auth/logout.
// Access token is persisted only because the existing API client reads the persisted
// Zustand state. Refresh is serialized to avoid a refresh storm when several requests
// observe an expired token at once.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  id: string
  orgId: string
  email: string
  name: string
  isActive: boolean
  roles: string[]
  assignments: Array<{
    projectId: string
    project: { id: string; name: string; code: string }
    role: { id: string; name: string }
  }>
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  sessionId: string
  expiresAt: number
}

export interface AuthState {
  user: AuthUser | null
  tokens: AuthTokens | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  logout: (remote?: boolean) => Promise<void>
  refreshAccessToken: () => Promise<void>
  setUser: (user: AuthUser) => void
  clearError: () => void
  hasRole: (role: string) => boolean
  hasAnyRole: (roles: string[]) => boolean
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

let refreshInFlight: Promise<void> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRefresh(expiresAt: number | undefined) {
  if (typeof window === 'undefined' || !expiresAt) return
  if (refreshTimer) clearTimeout(refreshTimer)

  // Refresh one minute before expiry, with a small safety floor.
  const delay = Math.max(10_000, expiresAt - Date.now() - 60_000)
  refreshTimer = setTimeout(() => {
    useAuthStore.getState().refreshAccessToken().catch(() => undefined)
  }, delay)
}

function clearRefreshTimer() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
}

async function parseResponse(res: Response): Promise<any> {
  return res.json().catch(() => ({}))
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      tokens: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null })
        clearRefreshTimer()

        try {
          const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          })
          const data = await parseResponse(res)

          if (!res.ok) throw new Error(data.detail || 'فشل تسجيل الدخول')
          if (!data.access_token || !data.session_id || !data.user) {
            throw new Error('استجابة المصادقة غير مكتملة من الخادم')
          }

          const user: AuthUser = {
            id: String(data.user.id),
            orgId: String(data.user.org_id),
            email: data.user.email,
            name: data.user.name,
            isActive: data.user.is_active,
            roles: data.user.assignments?.map((a: any) => a.role?.name).filter(Boolean) || [],
            assignments: data.user.assignments?.map((a: any) => ({
              projectId: String(a.project_id),
              project: {
                id: String(a.project_id),
                name: a.project?.name || '',
                code: a.project?.code || '',
              },
              role: { id: String(a.role_id), name: a.role?.name || '' },
            })) || [],
          }

          const expiresAt = Date.now() + ((data.expires_in || 900) * 1000)
          const tokens: AuthTokens = {
            accessToken: data.access_token,
            // Keep the body token as a compatibility fallback. Production refresh
            // also uses the HttpOnly cookie through credentials: include.
            refreshToken: data.refresh_token || '',
            sessionId: data.session_id,
            expiresAt,
          }

          set({ user, tokens, isAuthenticated: true, isLoading: false, error: null })
          scheduleRefresh(expiresAt)
        } catch (err: any) {
          set({ isLoading: false, error: err?.message || 'حدث خطأ أثناء تسجيل الدخول' })
          throw err
        }
      },

      logout: async (remote = true) => {
        const { tokens } = get()
        clearRefreshTimer()

        try {
          if (remote && tokens?.accessToken) {
            await fetch(`${API_BASE}/auth/logout`, {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens.accessToken}`,
              },
              body: JSON.stringify({ session_id: tokens.sessionId, revoke_all: false }),
            }).catch(() => undefined)
          }
        } finally {
          set({ user: null, tokens: null, isAuthenticated: false, isLoading: false, error: null })
        }
      },

      refreshAccessToken: async () => {
        if (refreshInFlight) return refreshInFlight

        const current = get().tokens
        if (!current?.refreshToken && !current?.sessionId) {
          await get().logout(false)
          throw new Error('No refresh session available')
        }

        refreshInFlight = (async () => {
          try {
            // Send the refresh token body for compatibility and the HttpOnly cookie
            // as the preferred production mechanism. The backend accepts either.
            const res = await fetch(`${API_BASE}/auth/refresh`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(current.refreshToken ? { refresh_token: current.refreshToken } : {}),
            })
            const data = await parseResponse(res)

            if (!res.ok || !data.access_token) {
              throw new Error(data.detail || `Refresh failed (${res.status})`)
            }

            const expiresAt = Date.now() + ((data.expires_in || 900) * 1000)
            // Backend currently rotates the refresh token in the cookie. If a
            // refresh_token is returned in a future version, retain that too.
            set({
              tokens: {
                ...get().tokens!,
                accessToken: data.access_token,
                refreshToken: data.refresh_token || get().tokens!.refreshToken,
                expiresAt,
              },
              isAuthenticated: true,
              error: null,
            })
            scheduleRefresh(expiresAt)
          } catch (err: any) {
            // A failed refresh means the session cannot be trusted. Clear local
            // state without making another authenticated network request.
            await get().logout(false)
            throw err
          } finally {
            refreshInFlight = null
          }
        })()

        return refreshInFlight
      },

      setUser: (user: AuthUser) => set({ user }),
      clearError: () => set({ error: null }),
      hasRole: (role: string) => get().user?.roles?.includes(role) || false,
      hasAnyRole: (roles: string[]) => roles.some(r => get().user?.roles?.includes(r)) || false,
    }),
    {
      name: 'fieldops-auth',
      partialize: (state) => ({
        user: state.user,
        tokens: state.tokens,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // Re-establish the proactive refresh cycle after a browser reload.
        if (state?.isAuthenticated && state.tokens?.expiresAt) {
          scheduleRefresh(state.tokens.expiresAt)
        }
      },
    }
  )
)
