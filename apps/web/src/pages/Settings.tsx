import { useState } from 'react'
import { 
  User, Bell, Shield, Key, Save, Mail, Smartphone,
  Loader2, CheckCircle2
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useAuthStore } from '../store/auth'
import { supabase } from '../lib/supabase'

export default function Settings() {
  const [activeTab, setActiveTab] = useState('profile')
  const { user, role, profile, settings, updateSettings, updateProfile } = useAuthStore()
  
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  
  // Local state for forms
  const [formData, setFormData] = useState({
    name: profile?.name || user?.user_metadata?.full_name || '',
    organization: profile?.organization || user?.user_metadata?.organization || '',
    email_alerts: settings?.email_alerts ?? true,
    system_alerts: settings?.system_alerts ?? true,
    incident_alerts: settings?.incident_alerts ?? true,
    report_notifications: settings?.report_notifications ?? true,
  })

  const TABS = [
    { id: 'profile', label: 'My Profile', icon: User },
    { id: 'security', label: 'Security & Auth', icon: Shield },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ]

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true)
    setSaveMessage('')

    try {
      // Save Profile
      if (activeTab === 'profile') {
        const { error } = await supabase.from('profiles').update({
          name: formData.name,
          organization: formData.organization
        }).eq('id', user.id)
        if (error) throw error;
        updateProfile({ name: formData.name, organization: formData.organization })
      } 
      // Save Settings
      else if (activeTab === 'notifications') {
        const newSettings = {
          email_alerts: formData.email_alerts,
          system_alerts: formData.system_alerts,
          incident_alerts: formData.incident_alerts,
          report_notifications: formData.report_notifications
        }
        const { error } = await supabase.from('user_settings').update(newSettings).eq('id', user.id)
        if (error) throw error;
        updateSettings(newSettings)
      }

      // Log the action
      await supabase.from('audit_logs').insert([
        { user_id: user.id, action: `Updated ${activeTab} settings`, metadata: { tab: activeTab } }
      ])

      setSaveMessage('Settings saved successfully.')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (err) {
      console.error(err)
      setSaveMessage('Failed to save settings.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col md:flex-row gap-8">
      
      {/* Sidebar Navigation */}
      <div className="w-full md:w-64 shrink-0">
        <h2 className="text-[13px] font-bold text-slate-400 uppercase tracking-wider mb-4 px-3">Personal Settings</h2>
        <nav className="space-y-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id)
                setSaveMessage('')
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-medium transition-all text-left",
                activeTab === tab.id 
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200" 
                  : "text-slate-600 hover:bg-white hover:text-slate-900 border border-transparent"
              )}
            >
              <tab.icon className={cn("w-4 h-4", activeTab === tab.id ? "text-slate-900" : "text-slate-400")} />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[500px]">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{TABS.find(t => t.id === activeTab)?.label}</h3>
            <p className="text-[13px] text-slate-500 mt-1">Manage your account preferences and security settings.</p>
          </div>
          <div className="flex items-center gap-4">
            {saveMessage && (
              <span className="text-[13px] font-bold text-emerald-600 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> {saveMessage}
              </span>
            )}
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[13px] font-bold transition-all shadow-sm shadow-blue-500/20 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} 
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 bg-slate-50/30">
          
          {activeTab === 'profile' && (
            <div className="max-w-2xl space-y-6">
              
              <div className="flex items-center gap-6 pb-6 border-b border-slate-200">
                <div className="w-20 h-20 rounded-full bg-slate-200 flex items-center justify-center text-2xl font-bold text-slate-500 uppercase shrink-0 border-4 border-white shadow-sm overflow-hidden">
                  {profile?.avatar ? (
                    <img src={profile.avatar} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    user?.email?.charAt(0) || 'U'
                  )}
                </div>
                <div>
                  <button className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-[13px] font-bold transition-all shadow-sm">
                    Change Avatar
                  </button>
                  <p className="text-[12px] text-slate-500 mt-2">JPG, GIF or PNG. 1MB max.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-2">Full Name</label>
                  <input 
                    type="text" 
                    value={formData.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" 
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-2">Organization</label>
                  <input 
                    type="text" 
                    value={formData.organization}
                    onChange={(e) => handleChange('organization', e.target.value)}
                    className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" 
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-2">Email Address</label>
                  <input type="email" disabled defaultValue={user?.email} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[14px] text-slate-500 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-slate-700 mb-2">Role</label>
                  <input type="text" disabled defaultValue={role || 'Viewer'} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[14px] text-slate-500 cursor-not-allowed uppercase font-bold" />
                </div>
              </div>

            </div>
          )}

          {activeTab === 'security' && (
            <div className="max-w-2xl space-y-6">
              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <div>
                  <h4 className="font-bold text-slate-900 text-[14px] flex items-center gap-2"><Key className="w-4 h-4 text-slate-400" /> Password</h4>
                  <p className="text-[13px] text-slate-500 mt-1">Change your password. We recommend a strong, unique password.</p>
                </div>
                <button className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-[13px] font-bold transition-all shadow-sm">
                  Update Password
                </button>
              </div>

              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900 text-[14px] flex items-center gap-2"><Smartphone className="w-4 h-4 text-slate-400" /> Two-Factor Auth</h4>
                    <p className="text-[13px] text-slate-500 mt-1">Add an extra layer of security to your account.</p>
                  </div>
                  <button className="bg-blue-50 text-blue-700 hover:bg-blue-100 px-4 py-2 rounded-lg text-[13px] font-bold transition-all shadow-sm">
                    Enable 2FA
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="max-w-2xl space-y-6">
              <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
                <h4 className="font-bold text-slate-900 text-[14px] flex items-center gap-2 border-b border-slate-100 pb-3"><Mail className="w-4 h-4 text-slate-400" /> Email Notifications</h4>
                
                {[
                  { key: 'incident_alerts', label: 'Critical Incidents', desc: 'Email me when a critical severity incident occurs.' },
                  { key: 'report_notifications', label: 'Daily Digest & Reports', desc: 'Send me generated reports and summaries.' },
                  { key: 'system_alerts', label: 'System Alerts', desc: 'Notify me of camera downtimes and platform maintenance.' }
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between pt-2">
                    <div>
                      <div className="font-bold text-slate-900 text-[13px]">{item.label}</div>
                      <div className="text-[12px] text-slate-500">{item.desc}</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={formData[item.key as keyof typeof formData] as boolean} 
                        onChange={(e) => handleChange(item.key, e.target.checked)}
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

    </div>
  )
}
