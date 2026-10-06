import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'

export type Role = 'Viewer' | 'Operator' | 'Supervisor' | 'Admin'

interface AuthState {
  user: User | null
  session: Session | null
  role: Role | null
  profile: any | null
  settings: any | null
  initialized: boolean
  setAuth: (session: Session | null, profile: any | null, settings: any | null) => void
  setInitialized: (val: boolean) => void
  updateSettings: (settings: any) => void
  updateProfile: (profile: any) => void
  logout: () => void
}

function getPrehydratedAuth(): {
  user: User | null
  session: Session | null
  role: Role | null
  profile: any | null
  settings: any | null
  initialized: boolean
} {
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('visionguard_demo_session')
      if (raw) {
        const parsed = JSON.parse(raw)
        const session = parsed.session || null
        const profile = parsed.profile || null
        const settings = parsed.settings || null
        const user = session?.user || null
        const role = (profile?.role as Role) || (user ? 'Viewer' : null)
        if (session) {
          return { user, session, role, profile, settings, initialized: true }
        }
      }
    }
  } catch {}
  return { user: null, session: null, role: null, profile: null, settings: null, initialized: false }
}

const initial = getPrehydratedAuth()

export const useAuthStore = create<AuthState>((set) => ({
  user: initial.user,
  session: initial.session,
  role: initial.role,
  profile: initial.profile,
  settings: initial.settings,
  initialized: initial.initialized,
  
  setAuth: (session, profile, settings) => {
    const user = session?.user ?? null
    // Role is server-controlled (profiles.role). Never trust user-editable user_metadata.
    const role = (profile?.role as Role) || (user ? 'Viewer' : null)
    
    set({ session, user, role, profile, settings })
  },
  
  setInitialized: (initialized) => set({ initialized }),
  
  updateSettings: (newSettings) => set((state) => ({ 
    settings: { ...state.settings, ...newSettings } 
  })),
  
  updateProfile: (newProfile) => set((state) => ({ 
    profile: { ...state.profile, ...newProfile },
    role: (newProfile?.role as Role) || state.role
  })),

  logout: () => {
    localStorage.removeItem('visionguard_demo_session')
    sessionStorage.setItem('visionguard_logged_out', 'true')
    set({ user: null, session: null, role: null, profile: null, settings: null, initialized: true })
  },
}))
