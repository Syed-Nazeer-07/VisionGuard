import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'

export type Role = 'Viewer' | 'Authority' | 'Admin'

interface AuthState {
  user: User | null
  session: Session | null
  role: Role | null
  initialized: boolean
  setSession: (session: Session | null) => void
  setInitialized: (val: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  role: null,
  initialized: false,
  setSession: (session) => {
    const user = session?.user ?? null
    // Extract role from user metadata, default to Viewer
    const role = (user?.user_metadata?.role as Role) || (user ? 'Viewer' : null)
    
    set({ session, user, role })
  },
  setInitialized: (initialized) => set({ initialized }),
}))
