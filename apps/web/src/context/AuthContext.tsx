import { createContext, useContext } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import type { Role } from '../store/auth'

export interface AuthContextType {
  session: Session | null
  user: User | null
  role: Role | null
  profile: any | null
  settings: any | null
  initialized: boolean
  loadingStep: string
  logout: () => Promise<void>
  updateProfile: (profile: any) => void
  updateSettings: (settings: any) => void
}

export const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
