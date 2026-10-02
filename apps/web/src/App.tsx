import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './components/auth/AuthProvider'
import { RequireAuth } from './components/layout/RequireAuth'
import { AppLayout } from './components/layout/AppLayout'
import { Landing } from './pages/Landing'
import Analyze from './pages/Analyze'
import SceneSetup from './pages/SceneSetup'
import { Login } from './pages/auth/Login'
import { Register } from './pages/auth/Register'
import { ForgotPassword } from './pages/auth/ForgotPassword'
import { ResetPassword } from './pages/auth/ResetPassword'
import Violations from './pages/Violations'
import ReviewQueue from './pages/ReviewQueue'
import Cameras from './pages/Cameras'
import { Monitor } from './pages/Monitor'
import Alerts from './pages/Alerts'
import { 
  Dashboard,
  Analytics,
  Reports,
  Admin,
  Settings
} from './pages/placeholders'

function App() {
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
              <Route index element={<Dashboard />} />
              <Route path="monitor" element={<Monitor />} />
              <Route path="analyze" element={<Analyze />} />
              <Route path="cameras" element={<Cameras />} />
              <Route path="cameras/:id/scene" element={<SceneSetup />} />
              <Route path="violations" element={<Violations />} />
              <Route path="review-queue" element={<ReviewQueue />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="reports" element={<Reports />} />
              <Route path="alerts" element={<Alerts />} />
              <Route path="admin" element={<Admin />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
