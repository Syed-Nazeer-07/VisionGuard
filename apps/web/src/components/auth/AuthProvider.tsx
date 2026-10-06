import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { useAuthStore, type Role } from '../../store/auth'
import { AuthContext, type AuthContextType, useAuth } from '../../context/AuthContext'
import { Shield } from 'lucide-react'
import { motion } from 'framer-motion'

export { useAuth, AuthContext }

// Module-level single-flight promise to prevent duplicate concurrent or remount bootstrapping
let globalBootstrapPromise: Promise<{
  session: Session | null
  profile: any | null
  settings: any | null
}> | null = null

let globalBootstrapCompleted = false

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const storeState = useAuthStore()
  
  const [session, setSession] = useState<Session | null>(storeState.session)
  const [user, setUser] = useState<User | null>(storeState.user)
  const [role, setRole] = useState<Role | null>(storeState.role)
  const [profile, setProfile] = useState<any | null>(storeState.profile)
  const [settings, setSettings] = useState<any | null>(storeState.settings)
  const [initialized, setInitialized] = useState<boolean>(storeState.initialized || globalBootstrapCompleted)
  const [loadingStep, setLoadingStep] = useState<string>('Verifying active session & loading profile...')

  const isMountedRef = useRef(true)

  // Single stable update dispatcher that updates local React state AND Zustand store together
  const applyAuthState = useCallback((newSession: Session | null, newProfile: any | null, newSettings: any | null) => {
    const newUser = newSession?.user ?? null
    const newRole = (newProfile?.role as Role) || (newUser ? 'Viewer' : null)

    if (isMountedRef.current) {
      setSession(newSession)
      setUser(newUser)
      setRole(newRole)
      setProfile(newProfile)
      setSettings(newSettings)
      setInitialized(true)
    }

    useAuthStore.getState().setAuth(newSession, newProfile, newSettings)
    useAuthStore.getState().setInitialized(true)
    globalBootstrapCompleted = true
  }, [])

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut()
    } catch (e) {
      console.warn('Sign out warning:', e)
    }
    applyAuthState(null, null, null)
  }, [applyAuthState])

  const updateProfile = useCallback((newProfileData: any) => {
    setProfile((prev: any) => {
      const merged = { ...prev, ...newProfileData }
      if (newProfileData?.role) setRole(newProfileData.role as Role)
      return merged
    })
    useAuthStore.getState().updateProfile(newProfileData)
  }, [])

  const updateSettings = useCallback((newSettingsData: any) => {
    setSettings((prev: any) => ({ ...prev, ...newSettingsData }))
    useAuthStore.getState().updateSettings(newSettingsData)
  }, [])

  useEffect(() => {
    isMountedRef.current = true

    async function executeBootstrap() {
      if (!globalBootstrapPromise) {
        globalBootstrapPromise = (async () => {
          try {
            // 1. Restore the existing Supabase session
            const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession()

            if (sessionError || !currentSession) {
              return { session: null, profile: null, settings: null }
            }

            // 2. Load profile and workspace settings once
            let loadedProfile: any = null
            let loadedSettings: any = null

            try {
              const [profileRes, settingsRes] = await Promise.all([
                supabase.from('profiles').select('*').eq('id', currentSession.user.id).maybeSingle(),
                supabase.from('user_settings').select('*').eq('id', currentSession.user.id).maybeSingle()
              ])

              loadedProfile = profileRes.data
              loadedSettings = settingsRes.data

              if (!loadedProfile && currentSession.user) {
                const { data: newProfile } = await supabase.from('profiles').insert([
                  {
                    id: currentSession.user.id,
                    role: 'Admin',
                    email: currentSession.user.email,
                    name: currentSession.user.user_metadata?.full_name || 'System Administrator'
                  }
                ]).select().maybeSingle()
                loadedProfile = newProfile
              }

              if (!loadedSettings && currentSession.user) {
                const { data: newSettings } = await supabase.from('user_settings').insert([
                  { id: currentSession.user.id }
                ]).select().maybeSingle()
                loadedSettings = newSettings
              }
            } catch (fetchErr) {
              console.warn('Profile/settings fetch error during bootstrap:', fetchErr)
            }

            if (loadedProfile?.status === 'Disabled') {
              await supabase.auth.signOut()
              return { session: null, profile: null, settings: null }
            }

            return {
              session: currentSession,
              profile: loadedProfile,
              settings: loadedSettings
            }
          } catch (err) {
            console.error('Failed to bootstrap workspace data:', err)
            return { session: null, profile: null, settings: null }
          }
        })()
      }

      const result = await globalBootstrapPromise
      if (isMountedRef.current) {
        applyAuthState(result.session, result.profile, result.settings)
      }
    }

    // Run bootstrap if not already initialized
    if (!globalBootstrapCompleted && !storeState.initialized) {
      setLoadingStep('Verifying active session & loading profile...')
      executeBootstrap()
    } else {
      setInitialized(true)
    }

    // Subscribe to auth state changes once for the application lifetime
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: any, newSession: any) => {
      if (event === 'SIGNED_OUT' || !newSession) {
        applyAuthState(null, null, null)
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        const currentUserId = useAuthStore.getState().user?.id
        if (currentUserId && currentUserId === newSession.user?.id) {
          applyAuthState(newSession, useAuthStore.getState().profile, useAuthStore.getState().settings)
        } else {
          try {
            const [pRes, sRes] = await Promise.all([
              supabase.from('profiles').select('*').eq('id', newSession.user.id).maybeSingle(),
              supabase.from('user_settings').select('*').eq('id', newSession.user.id).maybeSingle()
            ])
            applyAuthState(newSession, pRes.data || null, sRes.data || null)
          } catch {
            applyAuthState(newSession, null, null)
          }
        }
      }
    })

    return () => {
      isMountedRef.current = false
      subscription.unsubscribe()
    }
  }, [applyAuthState, storeState.initialized])

  const contextValue: AuthContextType = useMemo(() => ({
    session,
    user,
    role,
    profile,
    settings,
    initialized,
    loadingStep,
    logout,
    updateProfile,
    updateSettings
  }), [session, user, role, profile, settings, initialized, loadingStep, logout, updateProfile, updateSettings])

  // Only render bootstrap screen on genuine unknown initial startup
  if (!initialized) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#F8FAFC]">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center max-w-sm w-full text-center"
        >
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 mb-6 relative">
            <Shield className="w-10 h-10 text-blue-600 relative z-10" />
            <div className="absolute inset-0 border-2 border-blue-500 rounded-2xl animate-ping opacity-20"></div>
          </div>
          
          <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-2">
            Loading VisionGuard Workspace
          </h2>
          <p className="text-[13px] font-medium text-slate-500 uppercase tracking-wider mb-6 animate-pulse">
            {loadingStep}
          </p>

          <div className="w-64 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <motion.div 
              className="h-full bg-blue-600 rounded-full"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 1.5, ease: "easeInOut", repeat: Infinity }}
            />
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}
