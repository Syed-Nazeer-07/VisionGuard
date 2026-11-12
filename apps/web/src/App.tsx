import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import { AuthProvider } from './components/auth/AuthProvider'
import { RequireAuth } from './components/layout/RequireAuth'
import { RequireRole } from './components/layout/RequireRole'
import { Landing } from './pages/Landing'
import { Login } from './pages/auth/Login'
import { ForgotPassword } from './pages/auth/ForgotPassword'
import { ResetPassword } from './pages/auth/ResetPassword'
import { evidenceQueue } from './pipeline/evidence/queue'
import { useAuthStore } from './store/auth'
import { lazy, Suspense, useEffect } from 'react'

// The public site must not download admin screens, analytics libraries, or the
// inference workspace before someone actually enters an authenticated route.
const AppLayout = lazy(() => import('./components/layout/AppLayout').then(module => ({
  default: module.AppLayout
})));
const loadActivityPages = () => import('./pages/ActivityPages');
const Dashboard = lazy(() => loadActivityPages().then(module => ({ default: module.ActivityDashboard })));
const Analytics = lazy(() => loadActivityPages().then(module => ({ default: module.ActivityAnalytics })));
const Reports = lazy(() => loadActivityPages().then(module => ({ default: module.ActivityReports })));
const ActivityVideoLibrary = lazy(() => loadActivityPages().then(module => ({ default: module.ActivityVideoLibrary })));
const ActivityIncidents = lazy(() => loadActivityPages().then(module => ({ default: module.ActivityIncidents })));
const LegacyVideoLibrary = lazy(() => import('./pages/VideoLibrary').then(module => ({ default: module.VideoLibrary })));
const LegacyCases = lazy(() => import('./pages/Cases').then(module => ({ default: module.Cases })));
const Users = lazy(() => import('./pages/Users').then(module => ({ default: module.Users })));
const Config = lazy(() => import('./pages/Config').then(module => ({ default: module.Config })));
const AuditLogs = lazy(() => import('./pages/AuditLogs').then(module => ({ default: module.AuditLogs })));
const Settings = lazy(() => import('./pages/Settings'));

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

const START_PAGES = new Set([
  '/app/analyze', '/app/videos', '/app/cases', '/app/analytics', '/app/reports'
]);
function AppHome() {
  // The previously global localStorage preference leaked across accounts and
  // could send a Viewer to an Admin-only page. Use the signed-in owner's saved
  // settings and a strictly allowed route list.
  const startPage = useAuthStore(state => state.settings?.default_landing_page);
  if (startPage && START_PAGES.has(startPage)) {
    return <Navigate to={startPage} replace />
  }
  return <Dashboard />
}

function App() {
  const hasAuthenticatedSession = useAuthStore(state => Boolean(state.session))

  useEffect(() => {
    document.title = 'VisionGuard'
  }, [])

  // Public visitors do not need the evidence DB query or retention timer.
  useEffect(() => {
    if (hasAuthenticatedSession) evidenceQueue.startRetentionWorker()
  }, [hasAuthenticatedSession])

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          
          {/* Protected App Routes */}
          <Route path="/app" element={<RequireAuth />}>
            <Route element={
              <Suspense fallback={<div role="status" className="flex min-h-[40vh] items-center justify-center bg-[#f5f7f6] px-6 text-sm text-[#61747b]">Opening your workspace…</div>}>
                <AppLayout />
              </Suspense>
            }>
              <Route index element={<AppHome />} />
              <Route path="cameras" element={<Navigate to="/app/analyze" replace />} />
              <Route path="monitor" element={<Navigate to="/app/analyze" replace />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="reports" element={<Reports />} />
              <Route path="settings" element={<Settings />} />
              <Route path="analyze" element={null} />
              <Route path="videos" element={<ActivityVideoLibrary />} />
              <Route path="archive-videos" element={<LegacyVideoLibrary />} />
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
                <Route path="cases" element={<ActivityIncidents />} />
                <Route path="archive-cases" element={<LegacyCases />} />
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
