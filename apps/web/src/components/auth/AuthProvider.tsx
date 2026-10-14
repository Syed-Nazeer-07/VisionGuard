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

    if (newSettings) {
      try {
        const filters = newSettings.saved_filters || {}
        const profilePref = filters.default_detection_profile || newSettings.default_detection_profile
        if (profilePref) {
          localStorage.setItem('visionguard_detection_profile', profilePref)
        }
        const speedPref = filters.default_processing_speed || newSettings.default_processing_speed
        if (speedPref) {
          localStorage.setItem('visionguard_processing_speed', speedPref)
        }
        if (newSettings.density) {
          localStorage.setItem('visionguard_density', newSettings.density)
        }
        if (newSettings.default_landing_page) {
          localStorage.setItem('visionguard_default_landing_page', newSettings.default_landing_page)
        }
      } catch (e) {
        console.warn('Could not sync user settings to localStorage:', e)
      }
    }

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
            // Timeout safeguard to ensure bootstrap never hangs indefinitely
            const bootstrapTimeout = new Promise<{ session: Session | null; profile: any | null; settings: any | null }>(resolve => {
              setTimeout(() => resolve({ session: null, profile: null, settings: null }), 5000)
            })

            const bootstrapAction = (async () => {
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
            })()

            return await Promise.race([bootstrapAction, bootstrapTimeout])
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

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}
