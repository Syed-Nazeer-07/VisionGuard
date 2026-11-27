import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { watchAppearance } from './components/theme/ThemeControl'

watchAppearance()

// Supported browsers can identify another VisionGuard tab when selecting a
// capture source. This handle is visible only on the current app origin.
const media = navigator.mediaDevices as MediaDevices & {
  setCaptureHandleConfig?: (value: { handle: string; permittedOrigins: string[] }) => void
}
try {
  media?.setCaptureHandleConfig?.({ handle: 'visionguard', permittedOrigins: [location.origin] })
} catch { /* Optional browser capability. */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
