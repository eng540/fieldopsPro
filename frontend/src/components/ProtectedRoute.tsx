import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

/**
 * Route guard component.
 *
 * Checks if the user is authenticated (has both isAuthenticated flag and a valid
 * accessToken). If not, redirects to /login. Otherwise renders children.
 *
 * Constitutional (ADR-004): Access token in memory only — no localStorage/cookies.
 * On page refresh the token is lost, forcing re-authentication (acceptable for Sprint-1).
 */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const accessToken = useAuthStore((s) => s.accessToken)

  if (!isAuthenticated || !accessToken) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
