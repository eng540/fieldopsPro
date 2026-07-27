import { create } from 'zustand'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

interface AuthState {
  isAuthenticated: boolean
  user: {
    id: number
    email: string
    name: string
    role: string
    orgId: number
    projects: number[]
  } | null
  accessToken: string | null
  refreshToken: string | null
  sessionId: string | null
  deviceSecret: string | null
  // Actions
  login: (email: string, password: string, deviceKey: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  user: null,
  accessToken: null,
  refreshToken: null,
  sessionId: null,
  deviceSecret: null,

  login: async (email, password, deviceKey) => {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, device_public_key: deviceKey || undefined }),
    })

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      const detail = body.detail || `Login failed (${response.status})`
      throw new Error(detail)
    }

    const data = await response.json()

    // Store in memory ONLY (ADR-004: no localStorage/cookies for access token)
    set({
      isAuthenticated: true,
      accessToken: data.access_token,
      sessionId: data.session_id,
      refreshToken: data.refresh_token,
      user: data.user
        ? {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            role: data.user.role,
            orgId: data.user.org_id,
            projects: data.user.projects,
          }
        : null,
    })
  },

  logout: async () => {
    try {
      const state = get()
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.accessToken}`,
        },
        body: JSON.stringify({ session_id: state.sessionId, revoke_all: false }),
      })
    } catch {
      /* ignore errors during logout — clear state regardless */
    }
    set({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      refreshToken: null,
      sessionId: null,
    })
  },

  refresh: async () => {
    const refreshToken = get().refreshToken
    if (!refreshToken) throw new Error('No refresh token')

    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })

    if (!response.ok) {
      get().logout()
      throw new Error('Refresh failed')
    }

    const data = await response.json()
    set({ accessToken: data.access_token })
  },
}))
