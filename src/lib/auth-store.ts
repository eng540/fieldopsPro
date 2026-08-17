// FieldOps V4 — Auth State Management (Zustand)
// Hardened authentication lifecycle for FastAPI /auth/login, /auth/refresh, /auth/logout.
// Bootstrap is explicit: hydration -> refresh -> authenticated/unauthenticated.
// Refresh supports both persisted tokens and the backend HttpOnly refresh cookie.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser { id: string; orgId: string; email: string; name: string; isActive: boolean; roles: string[]; assignments: Array<{ projectId: string; project: { id: string; name: string; code: string }; role: { id: string; name: string } }> }
export interface AuthTokens { accessToken: string; refreshToken: string; sessionId: string; expiresAt: number }
export interface AuthState { user: AuthUser | null; tokens: AuthTokens | null; isAuthenticated: boolean; isLoading: boolean; isHydrated: boolean; isInitializing: boolean; error: string | null; login: (email: string, password: string) => Promise<void>; logout: (remote?: boolean) => Promise<void>; refreshAccessToken: () => Promise<void>; bootstrapAuth: () => Promise<void>; setUser: (user: AuthUser) => void; clearError: () => void; hasRole: (role: string) => boolean; hasAnyRole: (roles: string[]) => boolean }

const API_BASE = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : 'http://localhost:8000/api/v1')
const REQUEST_TIMEOUT_MS = 10_000
const HYDRATION_TIMEOUT_MS = 5_000
let refreshInFlight: Promise<void> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null

function scheduleRefresh(expiresAt: number | undefined) { if (typeof window === 'undefined' || !expiresAt) return; if (refreshTimer) clearTimeout(refreshTimer); const delay = Math.max(10_000, expiresAt - Date.now() - 60_000); refreshTimer = setTimeout(() => { useAuthStore.getState().refreshAccessToken().catch(() => undefined) }, delay) }
function clearRefreshTimer() { if (refreshTimer) clearTimeout(refreshTimer); refreshTimer = null }
async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { return await fetch(input, { ...init, signal: controller.signal }) } finally { clearTimeout(timer) } }
async function parseResponse(res: Response): Promise<any> { return res.json().catch(() => ({})) }

export const useAuthStore = create<AuthState>()(persist((set, get) => ({
  user: null, tokens: null, isAuthenticated: false, isLoading: false, isHydrated: false, isInitializing: true, error: null,
  login: async (email, password) => {
    set({ isLoading: true, error: null }); clearRefreshTimer()
    try {
      const res = await fetchWithTimeout(`${API_BASE}/auth/login`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
      const data = await parseResponse(res); if (!res.ok) throw new Error(data.detail || `فشل تسجيل الدخول (${res.status})`)
      if (!data.access_token || !data.session_id || !data.user) throw new Error('استجابة المصادقة غير مكتملة من الخادم')
      const user: AuthUser = { id: String(data.user.id), orgId: String(data.user.org_id), email: data.user.email, name: data.user.name, isActive: data.user.is_active, roles: data.user.assignments?.map((a: any) => a.role?.name).filter(Boolean) || [], assignments: data.user.assignments?.map((a: any) => ({ projectId: String(a.project_id), project: { id: String(a.project_id), name: a.project?.name || '', code: a.project?.code || '' }, role: { id: String(a.role_id), name: a.role?.name || '' } })) || [] }
      const expiresAt = Date.now() + ((data.expires_in || 900) * 1000)
      set({ user, tokens: { accessToken: data.access_token, refreshToken: data.refresh_token || '', sessionId: data.session_id, expiresAt }, isAuthenticated: true, isLoading: false, isInitializing: false, error: null }); scheduleRefresh(expiresAt)
    } catch (err: any) { const message = err?.name === 'AbortError' ? 'انتهت مهلة الاتصال بخادم المصادقة' : (err?.message || 'حدث خطأ أثناء تسجيل الدخول'); set({ isLoading: false, isInitializing: false, error: message, isAuthenticated: false }); throw new Error(message) }
  },
  logout: async (remote = true) => { const { tokens } = get(); clearRefreshTimer(); try { if (remote && tokens?.accessToken) await fetchWithTimeout(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.accessToken}` }, body: JSON.stringify({ session_id: tokens.sessionId, revoke_all: false }) }).catch(() => undefined) } finally { set({ user: null, tokens: null, isAuthenticated: false, isLoading: false, isInitializing: false, error: null }) } },
  refreshAccessToken: async () => {
    if (refreshInFlight) return refreshInFlight
    const current = get().tokens
    // The refresh endpoint also accepts the HttpOnly cookie. Do not reject
    // locally merely because persisted Zustand tokens are missing/stale.
    refreshInFlight = (async () => {
      try {
        const body = current?.refreshToken ? JSON.stringify({ refresh_token: current.refreshToken }) : undefined
        const res = await fetchWithTimeout(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...(body ? { body } : {}) })
        const data = await parseResponse(res)
        if (!res.ok || !data.access_token) throw new Error(res.status === 401 ? 'SESSION_EXPIRED' : (data.detail || `فشل تحديث الجلسة (${res.status})`))
        const expiresAt = Date.now() + ((data.expires_in || 900) * 1000)
        const latest = get().tokens
        set({ tokens: { ...(latest || current || { accessToken: '', refreshToken: '', sessionId: '' }), accessToken: data.access_token, refreshToken: data.refresh_token || latest?.refreshToken || current?.refreshToken || '', sessionId: data.session_id || latest?.sessionId || current?.sessionId || '', expiresAt }, isAuthenticated: true, isInitializing: false, error: null })
        scheduleRefresh(expiresAt)
      } catch (err: any) {
        const message = err?.name === 'AbortError' ? 'انتهت مهلة تحديث الجلسة' : (err?.message === 'SESSION_EXPIRED' ? 'انتهت جلسة الدخول، يرجى تسجيل الدخول مرة أخرى' : (err?.message || 'فشل تحديث الجلسة'))
        await get().logout(false); set({ isInitializing: false, isAuthenticated: false, error: message }); throw new Error(message)
      } finally { refreshInFlight = null }
    })()
    return refreshInFlight
  },
  bootstrapAuth: async () => { if (!get().isHydrated) return; const { tokens } = get(); if (!tokens?.sessionId && !tokens?.refreshToken) { set({ isInitializing: false, isAuthenticated: false, error: null }); return } set({ isInitializing: true, error: null }); try { await Promise.race([get().refreshAccessToken(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('انتهت مهلة تهيئة الجلسة')), REQUEST_TIMEOUT_MS + 2_000))]); set({ isAuthenticated: true, isInitializing: false, error: null }) } catch (err: any) { const message = err?.message || 'تعذر استعادة جلسة المصادقة'; console.warn('[FieldOps Auth] bootstrap failed:', message); await get().logout(false); set({ isAuthenticated: false, isInitializing: false, error: message }) } },
  setUser: user => set({ user }), clearError: () => set({ error: null }), hasRole: role => get().user?.roles?.includes(role) || false, hasAnyRole: roles => roles.some(r => get().user?.roles?.includes(r)) || false,
}), { name: 'fieldops-auth', partialize: state => ({ user: state.user, tokens: state.tokens, isAuthenticated: state.isAuthenticated }), onRehydrateStorage: () => (state, error) => { if (error) { console.error('[FieldOps Auth] hydration failed', error); useAuthStore.setState({ isHydrated: true, isInitializing: false, isAuthenticated: false, error: 'تعذر استعادة جلسة المصادقة' }); return }; useAuthStore.setState({ isHydrated: true, isInitializing: false }); if (state?.isAuthenticated && state.tokens?.expiresAt) scheduleRefresh(state.tokens.expiresAt) } }))

if (typeof window !== 'undefined') window.setTimeout(() => { const state = useAuthStore.getState(); if (!state.isHydrated) { console.error('[FieldOps Auth] hydration watchdog expired'); useAuthStore.setState({ isHydrated: true, isInitializing: false, isAuthenticated: false, error: 'انتهت مهلة تهيئة التخزين المحلي للجلسة' }) } }, HYDRATION_TIMEOUT_MS)
