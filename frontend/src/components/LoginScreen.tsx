import { useState, type FormEvent } from 'react'
import { useAuthStore } from '../stores/authStore'
import { Navigate } from 'react-router-dom'

/**
 * Login screen component.
 *
 * Provides email/password authentication with optional device public key.
 * On success, stores tokens in the auth store and redirects to dashboard.
 */
export default function LoginScreen() {
  const login = useAuthStore((s) => s.login)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [deviceKey, setDeviceKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Redirect if already authenticated
  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await login(email, password, deviceKey.trim())
    } catch (err: any) {
      const detail = err?.message || 'Login failed'
      // Extract detail from API error format if present
      if (detail.includes('API ')) {
        setError(detail)
      } else {
        setError(detail)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-slate-800">FieldOps V4.0</h1>
          <p className="mt-2 text-sm text-slate-500">
            Offline-First Field Operations Platform
          </p>
        </div>

        {/* Login Card */}
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-700">Sign In</h2>
          <p className="mt-1 text-sm text-slate-500">
            Enter your credentials to access the platform
          </p>

          {error && (
            <div className="mt-4 rounded-md bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700"
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-fieldops-500 focus:outline-none focus:ring-1 focus:ring-fieldops-500"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-fieldops-500 focus:outline-none focus:ring-1 focus:ring-fieldops-500"
              />
            </div>

            {/* Device Public Key (optional) */}
            <div>
              <label
                htmlFor="deviceKey"
                className="block text-sm font-medium text-slate-700"
              >
                Device Public Key{' '}
                <span className="text-slate-400">(optional)</span>
              </label>
              <textarea
                id="deviceKey"
                rows={3}
                value={deviceKey}
                onChange={(e) => setDeviceKey(e.target.value)}
                placeholder="Ed25519 or RSA public key for device trust (future feature)"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-fieldops-500 focus:outline-none focus:ring-1 focus:ring-fieldops-500 font-mono"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-fieldops-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-fieldops-700 focus:outline-none focus:ring-2 focus:ring-fieldops-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Signing in…
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-slate-400">
          Constitution v2.0 Baseline · ADR-004: JWT Minimalism
        </p>
      </div>
    </div>
  )
}
