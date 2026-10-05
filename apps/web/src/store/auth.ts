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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  role: null,
  profile: null,
  settings: null,
  initialized: false,
  
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

  logout: () => set({ user: null, session: null, role: null, profile: null, settings: null }),
}))
