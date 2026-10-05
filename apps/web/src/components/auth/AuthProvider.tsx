import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { Shield } from 'lucide-react'
import { motion } from 'framer-motion'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setAuth, setInitialized, initialized, logout } = useAuthStore()
  const [loadingStep, setLoadingStep] = useState<string>('Initializing...')

  useEffect(() => {
    let mounted = true;

    async function loadWorkspaceData() {
      try {
        setLoadingStep('Checking authentication token...')
        const { data: { session }, error: sessionError } = await supabase.auth.getSession()
        
        if (sessionError || !session) {
          if (mounted) {
            setAuth(null, null, null)
            setInitialized(true)
          }
          return
        }

        setLoadingStep('Verifying active session & loading profile...')
        // Parallel load profile and settings
        const [profileResponse, settingsResponse] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', session.user.id).single(),
          supabase.from('user_settings').select('*').eq('id', session.user.id).single()
        ])

        let profile = profileResponse.data
        let settings = settingsResponse.data

        if (profileResponse.error && profileResponse.error.code === 'PGRST116') {
          // Profile doesn't exist yet, we might need to create it manually if trigger failed
          const { data: newProfile } = await supabase.from('profiles').insert([
            { id: session.user.id, role: 'Viewer', email: session.user.email }
          ]).select().single()
          profile = newProfile
        }

        if (settingsResponse.error && settingsResponse.error.code === 'PGRST116') {
          // Settings doesn't exist yet
          const { data: newSettings } = await supabase.from('user_settings').insert([
            { id: session.user.id }
          ]).select().single()
          settings = newSettings
        }

        // Disabled accounts are denied by RLS; end their session in the UI as well.
        if (profile?.status === 'Disabled') {
          await supabase.auth.signOut()
          if (mounted) {
            setAuth(null, null, null)
            setInitialized(true)
          }
          return
        }

        setLoadingStep('Loading user permissions & workspace data...')

        if (mounted) {
          setAuth(session, profile, settings)
          setInitialized(true)
        }
      } catch (err) {
        console.error("Failed to load workspace data:", err)
        if (mounted) {
          setAuth(null, null, null)
          setInitialized(true)
        }
      }
    }

    loadWorkspaceData()

    // Listen for changes on auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event: any, session: any) => {
      if (event === 'SIGNED_OUT' || !session) {
        logout()
        setInitialized(true)
      } else if (event === 'SIGNED_IN') {
        // If they just signed in, re-run the workspace loader
        setInitialized(false)
        loadWorkspaceData()
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [setAuth, setInitialized, logout])

  // Don't render until we know the auth state
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

  return <>{children}</>
}
