import { useState, useEffect } from 'react'
import { 
  Camera, Shield, AlertOctagon, Settings2, Save,
  Loader2, CheckCircle2
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

export function Config() {
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState('cameras')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Settings State mapped to system_settings table
  const [settings, setSettings] = useState({
    // Camera tab
    global_fps_limit: '30 FPS',
    default_resolution: '1080p',
    auto_reconnect: true,
    
    // Detection Rules tab
    feature_speed_detection: true,
    feature_plate_detection: true,
    feature_red_light_detection: true,
    feature_helmet_detection: false,
    feature_lane_detection: true,
    
    // Alerts tab
    speed_limit_default: 60,
    speed_tolerance_default: 5,
    feature_alerts: true,

    // Preferences tab
    evidence_retention_days: 30,
    maintenance_mode: false
  })

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    setLoading(true)
    const { data, error } = await supabase.from('system_settings').select('*')
    if (data && !error) {
      const loaded: any = {}
      data.forEach((row: any) => {
        // row.value is jsonb
        loaded[row.key] = row.value
      })
      setSettings(prev => ({
        ...prev,
        ...loaded
      }))
    }
    setLoading(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveSuccess(false)
    setSaveError(null)

    try {
      const entries = Object.entries(settings)
      const upsertRows = entries.map(([key, value]) => ({
        key,
        value,
        updated_by: user?.id,
        updated_at: new Date().toISOString()
      }))

      const { error } = await supabase
        .from('system_settings')
        .upsert(upsertRows, { onConflict: 'key' })

      if (error) throw error

      // Audit Log
      if (user) {
        await supabase.from('audit_logs').insert([{
          user_id: user.id,
          action: 'Update System Configuration',
          metadata: { resource: 'system_settings', updated_keys: Object.keys(settings) }
        }])
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: any) {
      console.error('Failed to save settings:', err)
      setSaveError(err.message || 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  const TABS = [
    { id: 'cameras', label: 'Camera Configuration', icon: Camera },
    { id: 'rules', label: 'Detection Rules', icon: Shield },
    { id: 'alerts', label: 'Alert Thresholds', icon: AlertOctagon },
    { id: 'preferences', label: 'System Preferences', icon: Settings2 },
  ]

  return (
    <div className="flex flex-col md:flex-row gap-8">
      
      {/* Sidebar Navigation */}
      <div className="w-full md:w-64 shrink-0">
        <h2 className="text-[13px] font-bold text-slate-400 uppercase tracking-wider mb-4 px-3">Configuration Menu</h2>
        <nav className="space-y-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-medium transition-all text-left cursor-pointer",
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
            <p className="text-[13px] text-slate-500 mt-1">Manage system-wide parameters and operational bounds stored in database.</p>
          </div>
          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                <CheckCircle2 className="w-4 h-4" /> Persisted to Database
              </span>
            )}
            {saveError && (
              <span className="text-xs font-semibold text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-200">
                {saveError}
              </span>
            )}
            <button 
              onClick={handleSave}
              disabled={saving || loading}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-[13px] font-bold transition-all shadow-sm cursor-pointer"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>Save Changes</span>
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 bg-slate-50/30">
          
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-2" />
              <p className="text-[13px] font-medium text-slate-500">Loading system parameters from database...</p>
            </div>
          ) : (
            <div className="max-w-2xl space-y-6">

              {/* Cameras Tab */}
              {activeTab === 'cameras' && (
                <>
                  <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-slate-900 text-[14px]">Global FPS Limit</h4>
                        <p className="text-[13px] text-slate-500">Maximum frame rate for live streams across all clients.</p>
                      </div>
                      <select 
                        value={settings.global_fps_limit}
                        onChange={e => setSettings(s => ({ ...s, global_fps_limit: e.target.value }))}
                        className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[13px] font-medium text-slate-700 outline-none focus:border-slate-400 cursor-pointer"
                      >
                        <option value="15 FPS">15 FPS</option>
                        <option value="30 FPS">30 FPS</option>
                        <option value="60 FPS">60 FPS</option>
                        <option value="Unlimited">Unlimited</option>
                      </select>
                    </div>
                    <div className="w-full h-px bg-slate-100"></div>
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-slate-900 text-[14px]">Default Resolution</h4>
                        <p className="text-[13px] text-slate-500">Starting resolution for matrix and grid views.</p>
                      </div>
                      <select 
                        value={settings.default_resolution}
                        onChange={e => setSettings(s => ({ ...s, default_resolution: e.target.value }))}
                        className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[13px] font-medium text-slate-700 outline-none focus:border-slate-400 cursor-pointer"
                      >
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                        <option value="4K">4K</option>
                      </select>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-slate-900 text-[14px]">Auto-Reconnect</h4>
                        <p className="text-[13px] text-slate-500">Automatically attempt to restore dropped camera connections.</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={settings.auto_reconnect}
                          onChange={e => setSettings(s => ({ ...s, auto_reconnect: e.target.checked }))}
                          className="sr-only peer" 
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                      </label>
                    </div>
                  </div>
                </>
              )}

              {/* Rules Tab */}
              {activeTab === 'rules' && (
                <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 text-[14px]">Speed Violation Detection</h4>
                      <p className="text-[13px] text-slate-500">Flag vehicles exceeding calibrated roadway speed boundaries.</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={Boolean(settings.feature_speed_detection)}
                      onChange={e => setSettings(s => ({ ...s, feature_speed_detection: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded cursor-pointer" 
                    />
                  </div>
                  <div className="w-full h-px bg-slate-100"></div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 text-[14px]">Automated Plate Recognition (ANPR)</h4>
                      <p className="text-[13px] text-slate-500">Capture plate crop and run OCR pipeline during infractions.</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={Boolean(settings.feature_plate_detection)}
                      onChange={e => setSettings(s => ({ ...s, feature_plate_detection: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded cursor-pointer" 
                    />
                  </div>
                  <div className="w-full h-px bg-slate-100"></div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 text-[14px]">Red Light Violation Detection</h4>
                      <p className="text-[13px] text-slate-500">Identify vehicles entering intersections during stop phases.</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={Boolean(settings.feature_red_light_detection)}
                      onChange={e => setSettings(s => ({ ...s, feature_red_light_detection: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded cursor-pointer" 
                    />
                  </div>
                  <div className="w-full h-px bg-slate-100"></div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 text-[14px]">Lane Obstruction Detection</h4>
                      <p className="text-[13px] text-slate-500">Flag vehicles parked or stopped in active travel or bus lanes.</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={Boolean(settings.feature_lane_detection)}
                      onChange={e => setSettings(s => ({ ...s, feature_lane_detection: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded cursor-pointer" 
                    />
                  </div>
                </div>
              )}

              {/* Alerts Tab */}
              {activeTab === 'alerts' && (
                <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 text-[14px]">Default Speed Limit (km/h)</h4>
                      <p className="text-[13px] text-slate-500">Fallback speed threshold when camera calibration is absent.</p>
                    </div>
                    <input 
                      type="number"
                      value={settings.speed_limit_default}
                      onChange={e => setSettings(s => ({ ...s, speed_limit_default: Number(e.target.value) }))}
                      className="w-24 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-900" 
                    />
                  </div>
                  <div className="w-full h-px bg-slate-100"></div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 text-[14px]">Speed Tolerance Buffer (km/h)</h4>
                      <p className="text-[13px] text-slate-500">Grace threshold added to posted limit before alert triggers.</p>
                    </div>
                    <input 
                      type="number"
                      value={settings.speed_tolerance_default}
                      onChange={e => setSettings(s => ({ ...s, speed_tolerance_default: Number(e.target.value) }))}
                      className="w-24 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-900" 
                    />
                  </div>
                  <div className="w-full h-px bg-slate-100"></div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 text-[14px]">Real-Time Alert Dispatch</h4>
                      <p className="text-[13px] text-slate-500">Broadcast immediate notifications on high-severity events.</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={Boolean(settings.feature_alerts)}
                      onChange={e => setSettings(s => ({ ...s, feature_alerts: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded cursor-pointer" 
                    />
                  </div>
                </div>
              )}

              {/* Preferences Tab */}
              {activeTab === 'preferences' && (
                <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 text-[14px]">Evidence Retention (Days)</h4>
                      <p className="text-[13px] text-slate-500">Duration before unflagged video clips and snapshots expire.</p>
                    </div>
                    <input 
                      type="number"
                      value={settings.evidence_retention_days}
                      onChange={e => setSettings(s => ({ ...s, evidence_retention_days: Number(e.target.value) }))}
                      className="w-24 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-900" 
                    />
                  </div>
                  <div className="w-full h-px bg-slate-100"></div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900 text-[14px]">Maintenance Mode</h4>
                      <p className="text-[13px] text-slate-500">Suspend automated notifications during camera hardware maintenance.</p>
                    </div>
                    <input 
                      type="checkbox" 
                      checked={Boolean(settings.maintenance_mode)}
                      onChange={e => setSettings(s => ({ ...s, maintenance_mode: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded cursor-pointer" 
                    />
                  </div>
                </div>
              )}

            </div>
          )}

        </div>
      </div>

    </div>
  )
}
