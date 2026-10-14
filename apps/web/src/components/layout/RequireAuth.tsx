import { useState, useEffect } from 'react'
import { Navigate, Outlet, useLocation, Link } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { Loader2, RefreshCw } from 'lucide-react'

export function RequireAuth() {
  const session = useAuthStore(state => state.session)
  const initialized = useAuthStore(state => state.initialized)
  const setInitialized = useAuthStore(state => state.setInitialized)
  const location = useLocation()
  const [isStalled, setIsStalled] = useState(false)

  useEffect(() => {
    if (initialized) return
    const timer = setTimeout(() => {
      setIsStalled(true)
    }, 4500)
    return () => clearTimeout(timer)
  }, [initialized])

  if (!initialized) {
    return (
      <div className="flex-1 min-h-[50vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="inline-flex items-center gap-2 text-slate-500 text-xs font-medium">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
          <span>Verifying workspace session...</span>
        </div>
        {isStalled && (
          <div className="mt-4 flex items-center gap-3 text-xs text-slate-600">
            <span>Taking longer than expected?</span>
            <button
              onClick={() => {
                setInitialized(true)
              }}
              className="text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" /> Retry
            </button>
            <span className="text-slate-300">·</span>
            <Link
              to="/login"
              state={{ from: location }}
              className="text-slate-600 hover:text-slate-900 underline"
            >
              Sign In
            </Link>
          </div>
        )}
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}
