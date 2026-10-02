import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import type { Role } from '../../store/auth'

export function RequireRole({ allowedRoles }: { allowedRoles: Role[] }) {
  const { role } = useAuthStore()

  if (!role || !allowedRoles.includes(role)) {
    return <Navigate to="/app" replace />
  }

  return <Outlet />
}
