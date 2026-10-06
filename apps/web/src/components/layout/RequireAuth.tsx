import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'

export function RequireAuth() {
  const session = useAuthStore(state => state.session)
  const initialized = useAuthStore(state => state.initialized)
  const location = useLocation()

  if (!initialized) {
    return null
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}
