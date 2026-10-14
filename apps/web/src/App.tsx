import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import { AuthProvider } from './components/auth/AuthProvider'
import { RequireAuth } from './components/layout/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'
import { RequireRole } from './components/layout/RequireRole'
import { Landing } from './pages/Landing'
import { Login } from './pages/auth/Login'
import { Register } from './pages/auth/Register'
import { ForgotPassword } from './pages/auth/ForgotPassword'
import { ResetPassword } from './pages/auth/ResetPassword'

// Main Pages
import { Dashboard } from './pages/Dashboard'
import { Cases } from './pages/Cases'
import { Users } from './pages/Users'
import { Config } from './pages/Config'
import { AuditLogs } from './pages/AuditLogs'
import Analytics from './pages/Analytics'
import { Reports } from './pages/Reports'
import Analyze from './pages/Analyze'
import Settings from './pages/Settings'
import { VideoLibrary } from './pages/VideoLibrary'
import { evidenceQueue } from './pipeline/evidence/queue'
import { useEffect } from 'react'

function VideoReviewRedirect() {
  const [searchParams] = useSearchParams()
  const search = searchParams.toString()
  return <Navigate to={`/app/videos${search ? `?${search}` : ''}`} replace />
}

function IncidentsRedirect() {
  const [searchParams] = useSearchParams()
  const params = new URLSearchParams(searchParams)
  if (!params.has('tab')) {
    params.set('tab', 'incidents')
  }
  return <Navigate to={`/app/cases?${params.toString()}`} replace />
}

function ReviewQueueRedirect() {
  const [searchParams] = useSearchParams()
  const params = new URLSearchParams(searchParams)
  params.set('tab', 'review')
  return <Navigate to={`/app/cases?${params.toString()}`} replace />
}

function AppHome() {
  const customLanding = localStorage.getItem('visionguard_default_landing_page')
  if (customLanding && customLanding !== '/app' && customLanding.startsWith('/app/')) {
    return <Navigate to={customLanding} replace />
  }
  return <Dashboard />
}

function App() {
  useEffect(() => {
    document.title = 'VisionGuard'
    evidenceQueue.startRetentionWorker()
  }, [])

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          
          {/* Protected App Routes */}
          <Route path="/app" element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index element={<AppHome />} />
              <Route path="cameras" element={<Navigate to="/app/analyze" replace />} />
              <Route path="monitor" element={<Navigate to="/app/analyze" replace />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="reports" element={<Reports />} />
              <Route path="settings" element={<Settings />} />
              <Route path="analyze" element={<Analyze />} />
              <Route path="videos" element={<VideoLibrary />} />
              <Route path="video-review" element={<VideoReviewRedirect />} />
              <Route path="history" element={<Navigate to="/app/videos" replace />} />
              <Route path="alerts" element={<Navigate to="/app/cases?tab=incidents" replace />} />
              <Route path="violations" element={<Navigate to="/app/cases?tab=incidents" replace />} />
              <Route path="scene-setup" element={<Navigate to="/app/analyze" replace />} />

              {/* Staff operations */}
              <Route element={<RequireRole allowedRoles={['Viewer', 'Operator', 'Supervisor', 'Admin']} />}>
                <Route path="incidents" element={<IncidentsRedirect />} />
              </Route>
              <Route element={<RequireRole allowedRoles={['Viewer', 'Operator', 'Supervisor', 'Admin']} />}>
                <Route path="cases" element={<Cases />} />
              </Route>

              <Route element={<RequireRole allowedRoles={['Viewer', 'Operator', 'Supervisor', 'Admin']} />}>
                <Route path="review-queue" element={<ReviewQueueRedirect />} />
              </Route>

              <Route element={<RequireRole allowedRoles={['Viewer', 'Operator', 'Supervisor', 'Admin']} />}>
                <Route path="executive" element={<Navigate to="/app/analytics" replace />} />
              </Route>

              {/* Admin only */}
              <Route element={<RequireRole allowedRoles={['Admin']} />}>
                <Route path="users" element={<Users />} />
                <Route path="config" element={<Config />} />
                <Route path="audit" element={<AuditLogs />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
