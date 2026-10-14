import { useState, useEffect } from 'react'
import { 
  User, Bell, Shield, Key, Save, Mail,
  Loader2, CheckCircle2, Sliders, Monitor, Cpu, 
  Layers, Check, Globe, AlertTriangle
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useAuthStore } from '../store/auth'
import { supabase } from '../lib/supabase'

export function Settings() {
  const [activeTab, setActiveTab] = useState<'profile' | 'preferences' | 'analysis' | 'notifications' | 'security'>('profile')
  const { user, role, profile, settings, updateSettings, updateProfile } = useAuthStore()
  
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  
  // Local state for forms
  const [formData, setFormData] = useState({
    name: profile?.name || user?.user_metadata?.full_name || '',
    organization: profile?.organization || user?.user_metadata?.organization || '',
    timezone: profile?.timezone || 'UTC',
    
    // Appearance & Interface
    theme: settings?.theme || 'light',
    dark_mode: settings?.dark_mode ?? false,
    density: settings?.density || 'comfortable',
    default_landing_page: settings?.default_landing_page || '/app',

    // Analysis Defaults
    default_detection_profile: (typeof window !== 'undefined' ? localStorage.getItem('visionguard_detection_profile') : null) || settings?.saved_filters?.default_detection_profile || 'balanced',
    default_processing_speed: (typeof window !== 'undefined' ? localStorage.getItem('visionguard_processing_speed') : null) || settings?.saved_filters?.default_processing_speed || 'full',

    // Notifications
    email_alerts: settings?.email_alerts ?? true,
    system_alerts: settings?.system_alerts ?? true,
    incident_alerts: settings?.incident_alerts ?? true,
    report_notifications: settings?.report_notifications ?? true,

    // Security Password update
    newPassword: '',
    confirmPassword: ''
  })

  // Synchronize with loaded store when available
  useEffect(() => {
    if (profile || settings) {
      setFormData(prev => ({
        ...prev,
        name: profile?.name || prev.name,
        organization: profile?.organization || prev.organization,
        timezone: profile?.timezone || prev.timezone,
        theme: settings?.theme || prev.theme,
        dark_mode: settings?.dark_mode ?? prev.dark_mode,
        density: settings?.density || prev.density,
        default_landing_page: settings?.default_landing_page || prev.default_landing_page,
        email_alerts: settings?.email_alerts ?? prev.email_alerts,
        system_alerts: settings?.system_alerts ?? prev.system_alerts,
        incident_alerts: settings?.incident_alerts ?? prev.incident_alerts,
        report_notifications: settings?.report_notifications ?? prev.report_notifications,
        default_detection_profile: (localStorage.getItem('visionguard_detection_profile') as any) || settings?.saved_filters?.default_detection_profile || prev.default_detection_profile,
        default_processing_speed: (localStorage.getItem('visionguard_processing_speed') as any) || settings?.saved_filters?.default_processing_speed || prev.default_processing_speed,
      }))
    }
  }, [profile, settings])

  const TABS = [
    { id: 'profile', label: 'My Profile', icon: User },
    { id: 'preferences', label: 'Interface & Layout', icon: Monitor },
    { id: 'analysis', label: 'Analysis Defaults', icon: Cpu },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security & Auth', icon: Shield },
  ] as const

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    if (!user) return
    setIsSaving(true)
    setSaveMessage(null)

    try {
      // 1. Save Profile tab
      if (activeTab === 'profile') {
        const { error: profErr } = await supabase.from('profiles').update({
          name: formData.name,
          organization: formData.organization,
          timezone: formData.timezone
        }).eq('id', user.id)

        if (profErr) throw profErr
        updateProfile({
          name: formData.name,
          organization: formData.organization,
          timezone: formData.timezone
        })
      } 
      // 2. Save Interface & Layout tab
      else if (activeTab === 'preferences') {
        const prefSettings = {
          theme: formData.theme,
          dark_mode: formData.dark_mode,
          density: formData.density,
          default_landing_page: formData.default_landing_page
        }

        const { error: prefErr } = await supabase.from('user_settings').update(prefSettings).eq('id', user.id)
        if (prefErr) throw prefErr

        localStorage.setItem('visionguard_density', formData.density)
        localStorage.setItem('visionguard_default_landing_page', formData.default_landing_page)
        updateSettings(prefSettings)
      }
      // 3. Save Analysis Defaults
      else if (activeTab === 'analysis') {
        const updatedSavedFilters = {
          ...(settings?.saved_filters || {}),
          default_detection_profile: formData.default_detection_profile,
          default_processing_speed: formData.default_processing_speed
        }

        const { error: analysisErr } = await supabase.from('user_settings').update({
          saved_filters: updatedSavedFilters
        }).eq('id', user.id)

        if (analysisErr) throw analysisErr

        // Apply immediately to local execution preferences consumed by Analyze.tsx
        localStorage.setItem('visionguard_detection_profile', formData.default_detection_profile)
        localStorage.setItem('visionguard_processing_speed', formData.default_processing_speed)

        updateSettings({ saved_filters: updatedSavedFilters })
      }
      // 4. Save Notifications tab
      else if (activeTab === 'notifications') {
        const notifSettings = {
          email_alerts: formData.email_alerts,
          system_alerts: formData.system_alerts,
          incident_alerts: formData.incident_alerts,
          report_notifications: formData.report_notifications
        }

        const { error: notifErr } = await supabase.from('user_settings').update(notifSettings).eq('id', user.id)
        if (notifErr) throw notifErr
        updateSettings(notifSettings)
      }
      // 5. Save Security tab (Password change)
      else if (activeTab === 'security') {
        if (!formData.newPassword) {
          throw new Error('Please enter a new password.')
        }
        if (formData.newPassword !== formData.confirmPassword) {
          throw new Error('Passwords do not match.')
        }
        if (formData.newPassword.length < 8) {
          throw new Error('Password must be at least 8 characters long.')
        }

        const { error: pwdErr } = await supabase.auth.updateUser({
          password: formData.newPassword
        })

        if (pwdErr) throw pwdErr

        setFormData(prev => ({ ...prev, newPassword: '', confirmPassword: '' }))
      }

      // Record audit log
      await supabase.from('audit_logs').insert([
        { 
          user_id: user.id, 
          action: `Updated ${activeTab} preferences`, 
          metadata: { tab: activeTab } 
        }
      ])

      setSaveMessage({ text: 'Preferences saved successfully.', type: 'success' })
      setTimeout(() => setSaveMessage(null), 4000)
    } catch (err: any) {
      console.error('Settings save error:', err)
      setSaveMessage({ text: err.message || 'Failed to save settings.', type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
      
      {/* Header */}
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">User Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage your personal profile, interface preferences, analysis defaults, and notification settings.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        
        {/* Navigation Sidebar */}
        <div className="w-full md:w-60 shrink-0">
          <nav className="space-y-1 bg-white p-2 rounded-xl border border-slate-200 shadow-2xs">
            {TABS.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id)
                    setSaveMessage(null)
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all text-left cursor-pointer",
                    isActive 
                      ? "bg-slate-900 text-white shadow-2xs" 
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  <Icon className={cn("w-4 h-4", isActive ? "text-white" : "text-slate-400")} />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </nav>

          {/* Account Status Card */}
          <div className="mt-4 p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Session Details</span>
            <div className="text-slate-700">
              <span className="text-slate-400 block text-[10px]">Signed in as:</span>
              <span className="font-semibold block truncate">{user?.email}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">Access Role:</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800 border border-blue-200 mt-0.5">
                {role || 'Viewer'}
              </span>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden flex flex-col min-h-[500px]">
          
          {/* Header Bar */}
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {TABS.find(t => t.id === activeTab)?.label}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {activeTab === 'profile' && 'Update your identity and display preferences.'}
                {activeTab === 'preferences' && 'Customize theme, density, and default starting views.'}
                {activeTab === 'analysis' && 'Set default detection profiles and execution modes for video processing.'}
                {activeTab === 'notifications' && 'Configure automated delivery for alerts and digests.'}
                {activeTab === 'security' && 'Update your authentication password and view session security.'}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {saveMessage && (
                <span className={cn(
                  "text-xs font-semibold px-2.5 py-1 rounded-lg border flex items-center gap-1.5 animate-in fade-in duration-200",
                  saveMessage.type === 'success'
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-rose-50 text-rose-700 border-rose-200"
                )}>
                  {saveMessage.type === 'success' ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                  <span>{saveMessage.text}</span>
                </span>
              )}
              
              <button 
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-2xs disabled:opacity-50 cursor-pointer"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 
                <span>{isSaving ? 'Saving...' : 'Save Preferences'}</span>
              </button>
            </div>
          </div>

          {/* Form Body */}
          <div className="p-6 flex-1">
            
            {/* 1. Profile Tab */}
            {activeTab === 'profile' && (
              <div className="max-w-xl space-y-5">
                <div className="flex items-center gap-4 pb-5 border-b border-slate-100">
                  <div className="w-14 h-14 rounded-full bg-slate-900 text-white flex items-center justify-center text-lg font-bold uppercase shadow-2xs">
                    {formData.name ? formData.name.charAt(0) : user?.email?.charAt(0) || 'U'}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{formData.name || 'VisionGuard User'}</h4>
                    <p className="text-xs text-slate-500 font-mono">{user?.email}</p>
                  </div>
                </div>

                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Full Name</label>
                    <input 
                      type="text" 
                      value={formData.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                      placeholder="e.g. John Doe"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" 
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Organization / Department</label>
                    <input 
                      type="text" 
                      value={formData.organization}
                      onChange={(e) => handleChange('organization', e.target.value)}
                      placeholder="e.g. Traffic Operations Bureau"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" 
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Timezone</label>
                    <select
                      value={formData.timezone}
                      onChange={(e) => handleChange('timezone', e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
                    >
                      <option value="UTC">UTC (Coordinated Universal Time)</option>
                      <option value="America/New_York">America/New_York (Eastern)</option>
                      <option value="America/Chicago">America/Chicago (Central)</option>
                      <option value="America/Denver">America/Denver (Mountain)</option>
                      <option value="America/Los_Angeles">America/Los_Angeles (Pacific)</option>
                      <option value="Europe/London">Europe/London (GMT/BST)</option>
                      <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                      <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="block font-medium text-slate-400 mb-1">Email Address</label>
                      <input 
                        type="text" 
                        disabled 
                        value={user?.email || ''} 
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 cursor-not-allowed font-mono text-[11px]" 
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-400 mb-1">Assigned Role</label>
                      <input 
                        type="text" 
                        disabled 
                        value={role || 'Viewer'} 
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 cursor-not-allowed uppercase font-bold text-[11px]" 
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Interface & Layout Preferences */}
            {activeTab === 'preferences' && (
              <div className="max-w-xl space-y-5 text-xs">
                
                {/* Density Selection */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <span className="font-bold text-slate-800 block">Table & Interface Density</span>
                  <p className="text-slate-500 text-[11px]">Controls padding in queue tables and analytical views.</p>
                  
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <label className={cn(
                      "p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all",
                      formData.density === 'comfortable' ? "bg-white border-blue-500 shadow-2xs" : "bg-white/60 border-slate-200 hover:bg-white"
                    )}>
                      <div>
                        <span className="font-bold text-slate-900 block">Comfortable</span>
                        <span className="text-[11px] text-slate-500">Spacious padding</span>
                      </div>
                      <input 
                        type="radio" 
                        name="density" 
                        checked={formData.density === 'comfortable'} 
                        onChange={() => handleChange('density', 'comfortable')} 
                        className="text-blue-600"
                      />
                    </label>

                    <label className={cn(
                      "p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all",
                      formData.density === 'compact' ? "bg-white border-blue-500 shadow-2xs" : "bg-white/60 border-slate-200 hover:bg-white"
                    )}>
                      <div>
                        <span className="font-bold text-slate-900 block">Compact</span>
                        <span className="text-[11px] text-slate-500">High-density rows</span>
                      </div>
                      <input 
                        type="radio" 
                        name="density" 
                        checked={formData.density === 'compact'} 
                        onChange={() => handleChange('density', 'compact')} 
                        className="text-blue-600"
                      />
                    </label>
                  </div>
                </div>

                {/* Default Landing Page */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <span className="font-bold text-slate-800 block">Default Landing Workspace</span>
                  <p className="text-slate-500 text-[11px]">Route automatically opened upon sign in.</p>
                  
                  <select
                    value={formData.default_landing_page}
                    onChange={(e) => handleChange('default_landing_page', e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer font-medium"
                  >
                    <option value="/app">Operational Dashboard (/app)</option>
                    <option value="/app/analyze">Live Video Analysis (/app/analyze)</option>
                    <option value="/app/videos">History & Video Review (/app/videos)</option>
                    <option value="/app/incidents">Incident Center (/app/incidents)</option>
                    <option value="/app/incidents?tab=review">Incident Review Queue (/app/incidents?tab=review)</option>
                    <option value="/app/cases">Case Management (/app/cases)</option>
                    <option value="/app/analytics">Traffic Analytics & Intelligence (/app/analytics)</option>
                    <option value="/app/reports">Reports (/app/reports)</option>
                  </select>
                </div>

              </div>
            )}

            {/* 3. Analysis Defaults Tab */}
            {activeTab === 'analysis' && (
              <div className="max-w-xl space-y-5 text-xs">
                
                {/* Default Detection Profile */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <span className="font-bold text-slate-800 block">Default Detection Quality Profile</span>
                  <p className="text-slate-500 text-[11px]">Applied to newly uploaded video analysis runs by default.</p>
                  
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <label className={cn(
                      "p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all",
                      formData.default_detection_profile === 'balanced' ? "bg-white border-blue-500 shadow-2xs" : "bg-white/60 border-slate-200 hover:bg-white"
                    )}>
                      <div>
                        <span className="font-bold text-slate-900 block">Balanced</span>
                        <span className="text-[11px] text-slate-500">0.20 conf • 0.45 IoU (Recommended)</span>
                      </div>
                      <input 
                        type="radio" 
                        name="detection_profile" 
                        checked={formData.default_detection_profile === 'balanced'} 
                        onChange={() => handleChange('default_detection_profile', 'balanced')} 
                        className="text-blue-600"
                      />
                    </label>

                    <label className={cn(
                      "p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all",
                      formData.default_detection_profile === 'high_recall' ? "bg-white border-blue-500 shadow-2xs" : "bg-white/60 border-slate-200 hover:bg-white"
                    )}>
                      <div>
                        <span className="font-bold text-slate-900 block">High Recall</span>
                        <span className="text-[11px] text-slate-500">0.15 conf • 0.45 IoU (Dense traffic)</span>
                      </div>
                      <input 
                        type="radio" 
                        name="detection_profile" 
                        checked={formData.default_detection_profile === 'high_recall'} 
                        onChange={() => handleChange('default_detection_profile', 'high_recall')} 
                        className="text-blue-600"
                      />
                    </label>
                  </div>
                </div>

                {/* Default Processing Speed */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <span className="font-bold text-slate-800 block">Default Processing Speed Mode</span>
                  <p className="text-slate-500 text-[11px]">Inference cadence for offline and uploaded video files.</p>
                  
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <label className={cn(
                      "p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all",
                      formData.default_processing_speed === 'full' ? "bg-white border-blue-500 shadow-2xs" : "bg-white/60 border-slate-200 hover:bg-white"
                    )}>
                      <div>
                        <span className="font-bold text-slate-900 block">Full Detection (1x)</span>
                        <span className="text-[11px] text-slate-500">Evaluates every frame (Default)</span>
                      </div>
                      <input 
                        type="radio" 
                        name="processing_speed" 
                        checked={formData.default_processing_speed === 'full'} 
                        onChange={() => handleChange('default_processing_speed', 'full')} 
                        className="text-blue-600"
                      />
                    </label>

                    <label className={cn(
                      "p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all",
                      formData.default_processing_speed === 'fast' ? "bg-white border-blue-500 shadow-2xs" : "bg-white/60 border-slate-200 hover:bg-white"
                    )}>
                      <div>
                        <span className="font-bold text-slate-900 block">Fast Processing (2x)</span>
                        <span className="text-[11px] text-slate-500">Every 2nd frame + motion tracking</span>
                      </div>
                      <input 
                        type="radio" 
                        name="processing_speed" 
                        checked={formData.default_processing_speed === 'fast'} 
                        onChange={() => handleChange('default_processing_speed', 'fast')} 
                        className="text-blue-600"
                      />
                    </label>
                  </div>
                </div>

              </div>
            )}

            {/* 4. Notifications Tab */}
            {activeTab === 'notifications' && (
              <div className="max-w-xl space-y-3 text-xs">
                {[
                  { key: 'incident_alerts', label: 'Critical Incident Notifications', desc: 'Receive immediate alerts when Critical or High severity traffic safety infractions occur.' },
                  { key: 'report_notifications', label: 'Automated Reports & Digests', desc: 'Receive periodic analytics digests and notifications upon report generation.' },
                  { key: 'system_alerts', label: 'Platform & Analysis Alerts', desc: 'Receive notifications when video analysis runs complete or encounter pipeline errors.' }
                ].map(item => (
                  <div key={item.key} className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div className="max-w-md">
                      <span className="font-bold text-slate-900 block">{item.label}</span>
                      <span className="text-slate-500 text-[11px] leading-relaxed block mt-0.5">{item.desc}</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                      <input 
                        type="checkbox" 
                        checked={Boolean(formData[item.key as keyof typeof formData])} 
                        onChange={(e) => handleChange(item.key, e.target.checked)}
                        className="sr-only peer" 
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                ))}
              </div>
            )}

            {/* 5. Security Tab */}
            {activeTab === 'security' && (
              <div className="max-w-xl space-y-4 text-xs">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                      <Key className="w-4 h-4 text-slate-400" />
                      <span>Change Account Password</span>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Enter a new password for your authenticated Supabase user profile.
                    </p>
                  </div>

                  <div className="space-y-3 pt-1">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">New Password</label>
                      <input 
                        type="password" 
                        value={formData.newPassword}
                        onChange={(e) => handleChange('newPassword', e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono" 
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">Confirm New Password</label>
                      <input 
                        type="password" 
                        value={formData.confirmPassword}
                        onChange={(e) => handleChange('confirmPassword', e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono" 
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-800 block">Session Security & RLS</span>
                    <span className="text-slate-500 text-[11px] block mt-0.5">
                      Session authenticated via Supabase JWT with Row-Level Security enforcement.
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Active Session
                  </span>
                </div>
              </div>
            )}

          </div>
        </div>

      </div>

    </div>
  )
}
export default Settings
