// FieldOps V4 — Auth State Management (Zustand)
// Wired to FastAPI /auth/login, /auth/refresh, /auth/logout
// Uses JWT access_token + HttpOnly cookie refresh_token

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ============================================================
// Types
// ============================================================

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

  // Actions
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshAccessToken: () => Promise<void>
  setUser: (user: AuthUser) => void
  clearError: () => void
  hasRole: (role: string) => boolean
  hasAnyRole: (roles: string[]) => boolean
}

// ============================================================
// API Base URL
// ============================================================

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

// ============================================================
// Store
// ============================================================

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

        try {
          const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          })

          const data = await res.json()

          if (!res.ok) {
            throw new Error(data.detail || 'فشل تسجيل الدخول')
          }

          // Map FastAPI response to AuthUser
          const user: AuthUser = {
            id: String(data.user.id),
            orgId: String(data.user.org_id),
            email: data.user.email,
            name: data.user.name,
            isActive: data.user.is_active,
            roles: data.user.assignments?.map((a: any) => a.role?.name).filter(Boolean) || [],
            assignments: data.user.assignments?.map((a: any) => ({
              projectId: String(a.project_id),
              project: { id: String(a.project_id), name: a.project?.name || '', code: a.project?.code || '' },
              role: { id: String(a.role_id), name: a.role?.name || '' },
            })) || [],
          }

          set({
            user,
            tokens: {
              accessToken: data.access_token,
              refreshToken: data.refresh_token || '',
              sessionId: data.session_id || '',
              expiresAt: Date.now() + ((data.expires_in || 900) * 1000),
            },
            isAuthenticated: true,
            isLoading: false,
            error: null,
          })
        } catch (err: any) {
          set({
            isLoading: false,
            error: err.message || 'حدث خطأ أثناء تسجيل الدخول',
          })
          throw err
        }
      },

      logout: async () => {
        const { tokens } = get()
        try {
          if (tokens?.accessToken) {
            await fetch(`${API_BASE}/auth/logout`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${tokens.accessToken}`,
              },
              body: JSON.stringify({
                session_id: tokens.sessionId,
                revoke_all: true,
              }),
            }).catch(() => {})
          }
        } finally {
          set({
            user: null,
            tokens: null,
            isAuthenticated: false,
            error: null,
          })
        }
      },

      refreshAccessToken: async () => {
        const { tokens } = get()
        if (!tokens?.refreshToken) return

        try {
          const res = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: tokens.refreshToken }),
          })

          if (res.ok) {
            const data = await res.json()
            set({
              tokens: {
                ...tokens,
                accessToken: data.access_token,
                expiresAt: Date.now() + ((data.expires_in || 900) * 1000),
              },
            })
          }
        } catch {
          set({ user: null, tokens: null, isAuthenticated: false })
        }
      },

      setUser: (user: AuthUser) => set({ user }),

      clearError: () => set({ error: null }),

      hasRole: (role: string) => {
        const { user } = get()
        return user?.roles?.includes(role) || false
      },

      hasAnyRole: (roles: string[]) => {
        const { user } = get()
        return roles.some(r => user?.roles?.includes(r)) || false
      },
    }),
    {
      name: 'fieldops-auth',
      partialize: (state) => ({
        user: state.user,
        tokens: state.tokens,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
