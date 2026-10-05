import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './components/auth/AuthProvider'
import { RequireAuth } from './components/layout/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'
import { RequireRole } from './components/layout/RequireRole'
import { Landing } from './pages/Landing'
import { Login } from './pages/auth/Login'
import { ForgotPassword } from './pages/auth/ForgotPassword'
import { ResetPassword } from './pages/auth/ResetPassword'

// Main Pages
import { Dashboard } from './pages/Dashboard'
import { Cameras } from './pages/Cameras'
import { Cases } from './pages/Cases'
import { Monitor } from './pages/Monitor'
import { IncidentCenter } from './pages/IncidentCenter'
import { Users } from './pages/Users'
import { Config } from './pages/Config'
import { AuditLogs } from './pages/AuditLogs'
import Analytics from './pages/Analytics'
import { Reports } from './pages/Reports'
import { ExecutiveIntelligence } from './pages/ExecutiveIntelligence'
import Analyze from './pages/Analyze'
import Settings from './pages/Settings'
import ReviewQueue from './pages/ReviewQueue'
import VideoReview from './pages/VideoReview'
import { VideoLibrary } from './pages/VideoLibrary'
import { evidenceQueue } from './pipeline/evidence/queue'
import { useEffect } from 'react'

function App() {
  useEffect(() => {
    evidenceQueue.startRetentionWorker()
  }, [])

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
            <Route element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="cameras" element={<Cameras />} />
              <Route path="monitor" element={<Monitor />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="reports" element={<Reports />} />
              <Route path="settings" element={<Settings />} />
              <Route path="analyze" element={<Analyze />} />
              <Route path="videos" element={<VideoLibrary />} />

              {/* Staff operations */}
              <Route element={<RequireRole allowedRoles={['Operator', 'Supervisor', 'Admin']} />}>
                <Route path="incidents" element={<IncidentCenter />} />
                <Route path="cases" element={<Cases />} />
              </Route>

              <Route element={<RequireRole allowedRoles={['Supervisor', 'Admin']} />}>
                <Route path="review-queue" element={<ReviewQueue />} />
                <Route path="video-review" element={<VideoReview />} />
              </Route>

              <Route element={<RequireRole allowedRoles={['Viewer', 'Supervisor', 'Admin']} />}>
                <Route path="executive" element={<ExecutiveIntelligence />} />

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
