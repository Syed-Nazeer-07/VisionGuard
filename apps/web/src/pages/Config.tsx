import { useState, useEffect } from 'react'
import { 
  Shield, AlertOctagon, Settings2, Save,
  Loader2, CheckCircle2, Cpu, HardDrive, 
  RotateCcw, AlertTriangle, Check, Info, Sliders,
  Gauge, Radio, FileText, Lock
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

export function Config() {
  const { user, role } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'detection' | 'rules' | 'retention' | 'platform'>('detection')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Settings State mapped directly to system_settings table
  const [settings, setSettings] = useState({
    // Detection & Processing defaults
    default_detection_profile: 'balanced',
    default_processing_speed: 'full',
    default_confidence_threshold: 0.20,
    default_iou_threshold: 0.45,
    
    // Traffic Rules & Thresholds
    speed_limit_default: 60,
    speed_tolerance_default: 5,
    feature_speed_detection: true,
    feature_plate_detection: true,
    feature_red_light_detection: true,
    feature_lane_detection: true,
    
    // Data & Retention
    evidence_retention_days: 30,
    artifact_retention_days: 90,
    
    // Platform & Alerts
    feature_alerts: true,
    maintenance_mode: false
  })

  const isAdmin = role === 'Admin'

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('system_settings').select('*')
      if (data && !error) {
        const loaded: any = {}
        data.forEach((row: any) => {
          loaded[row.key] = row.value
        })
        setSettings(prev => ({
          ...prev,
          ...loaded
        }))
      }
    } catch (err: any) {
      console.warn('Failed to load system_settings:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!isAdmin) {
      setSaveError('Administrator privileges required to persist system configuration.')
      return
    }

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

      const { error: upsertErr } = await supabase
        .from('system_settings')
        .upsert(upsertRows, { onConflict: 'key' })

      if (upsertErr) throw upsertErr

      // Record audit log
      if (user) {
        await supabase.from('audit_logs').insert([{
          user_id: user.id,
          action: 'Update System Configuration',
          metadata: { 
            tab: activeTab, 
            updated_keys: Object.keys(settings) 
          }
        }])
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3500)
    } catch (err: any) {
      console.error('Failed to save settings:', err)
      setSaveError(err.message || 'Failed to save configuration.')
    } finally {
      setSaving(false)
    }
  }

  const TABS = [
    { id: 'detection', label: 'Detection & Processing', icon: Cpu, desc: 'YOLO11n ONNX inference parameters and execution cadence' },
    { id: 'rules', label: 'Traffic Rules & Bounds', icon: Shield, desc: 'Speed thresholds, violation triggers, and rule enablement' },
    { id: 'retention', label: 'Data & Storage Retention', icon: HardDrive, desc: 'Evidence snapshot retention and artifact storage policies' },
    { id: 'platform', label: 'Platform & Alerts', icon: Settings2, desc: 'Real-time alert broadcasting and maintenance mode' },
  ] as const

  return (
    <div className="space-y-6 max-w-[1500px] mx-auto pb-12">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">System Configuration</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              System Settings & Rules
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Manage system-wide detection defaults, traffic rule thresholds, and data retention policies stored in database.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {saveSuccess && (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Saved to System Database
            </span>
          )}
          {saveError && (
            <span className="text-xs font-semibold text-rose-700 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200 animate-in fade-in">
              {saveError}
            </span>
          )}
          <button 
            onClick={handleSave}
            disabled={saving || loading || !isAdmin}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>Save Configuration</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        
        {/* Navigation Sidebar */}
        <div className="w-full md:w-64 shrink-0">
          <nav className="space-y-1 bg-white p-2 rounded-xl border border-slate-200 shadow-2xs">
            {TABS.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id)
                    setSaveError(null)
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-all text-left cursor-pointer",
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

          {!isAdmin && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs">
              <span className="font-bold block flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" /> Read-Only Mode
              </span>
              <p className="text-[11px] mt-0.5">
                Administrator permissions required to update system-level parameters.
              </p>
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 bg-white border border-slate-200 rounded-xl shadow-2xs overflow-hidden flex flex-col min-h-[500px]">
          
          {/* Header Bar */}
          <div className="p-5 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-base font-bold text-slate-900">
              {TABS.find(t => t.id === activeTab)?.label}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {TABS.find(t => t.id === activeTab)?.desc}
            </p>
          </div>

          {/* Form Body */}
          <div className="p-6 flex-1 text-xs">
            {loading ? (
              <div className="h-64 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
                <p className="text-xs font-medium text-slate-500">Loading system parameters from database...</p>
              </div>
            ) : (
              <div className="max-w-2xl space-y-6">

                {/* TAB 1: Detection & Processing */}
                {activeTab === 'detection' && (
                  <div className="space-y-4">
                    
                    {/* Default Detection Profile */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                      <div>
                        <span className="font-bold text-slate-900 text-xs block">Default Detection Profile</span>
                        <p className="text-slate-500 text-[11px] mt-0.5">
                          Determines the baseline confidence and IoU matching thresholds for YOLO11n ONNX inference.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <label className={cn(
                          "p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all",
                          settings.default_detection_profile === 'balanced' ? "bg-white border-blue-500 shadow-2xs" : "bg-white/60 border-slate-200 hover:bg-white"
                        )}>
                          <div>
                            <span className="font-bold text-slate-900 block">Balanced Profile</span>
                            <span className="text-[11px] text-slate-500">0.20 Conf • 0.45 IoU (Recommended default)</span>
                          </div>
                          <input 
                            type="radio" 
                            name="default_detection_profile" 
                            checked={settings.default_detection_profile === 'balanced'} 
                            onChange={() => handleChange('default_detection_profile', 'balanced')} 
                            className="text-blue-600"
                          />
                        </label>

                        <label className={cn(
                          "p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all",
                          settings.default_detection_profile === 'high_recall' ? "bg-white border-blue-500 shadow-2xs" : "bg-white/60 border-slate-200 hover:bg-white"
                        )}>
                          <div>
                            <span className="font-bold text-slate-900 block">High Recall Profile</span>
                            <span className="text-[11px] text-slate-500">0.15 Conf • 0.45 IoU (Dense congestion)</span>
                          </div>
                          <input 
                            type="radio" 
                            name="default_detection_profile" 
                            checked={settings.default_detection_profile === 'high_recall'} 
                            onChange={() => handleChange('default_detection_profile', 'high_recall')} 
                            className="text-blue-600"
                          />
                        </label>
                      </div>
                    </div>

                    {/* Default Processing Speed Mode */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                      <div>
                        <span className="font-bold text-slate-900 text-xs block">Default Processing Speed Cadence</span>
                        <p className="text-slate-500 text-[11px] mt-0.5">
                          Inference cadence for video analysis. Fast Processing utilizes motion-aware bounding-box prediction on intermediate frames.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <label className={cn(
                          "p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all",
                          settings.default_processing_speed === 'full' ? "bg-white border-blue-500 shadow-2xs" : "bg-white/60 border-slate-200 hover:bg-white"
                        )}>
                          <div>
                            <span className="font-bold text-slate-900 block">Full Detection (1x Stride)</span>
                            <span className="text-[11px] text-slate-500">Evaluates every frame directly (Highest fidelity)</span>
                          </div>
                          <input 
                            type="radio" 
                            name="default_processing_speed" 
                            checked={settings.default_processing_speed === 'full'} 
                            onChange={() => handleChange('default_processing_speed', 'full')} 
                            className="text-blue-600"
                          />
                        </label>

                        <label className={cn(
                          "p-3 rounded-lg border flex items-center justify-between cursor-pointer transition-all",
                          settings.default_processing_speed === 'fast' ? "bg-white border-blue-500 shadow-2xs" : "bg-white/60 border-slate-200 hover:bg-white"
                        )}>
                          <div>
                            <span className="font-bold text-slate-900 block">Fast Processing (2x Stride)</span>
                            <span className="text-[11px] text-slate-500">Every 2nd frame + linear motion interpolation</span>
                          </div>
                          <input 
                            type="radio" 
                            name="default_processing_speed" 
                            checked={settings.default_processing_speed === 'fast'} 
                            onChange={() => handleChange('default_processing_speed', 'fast')} 
                            className="text-blue-600"
                          />
                        </label>
                      </div>
                    </div>

                    {/* Technical Inference Parameters */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                      <span className="font-bold text-slate-900 text-xs block">Baseline Inference Parameters</span>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-slate-700 font-bold mb-1">Confidence Filter Threshold</label>
                          <input 
                            type="number" 
                            step="0.01" 
                            min="0.05" 
                            max="0.95"
                            value={settings.default_confidence_threshold}
                            onChange={e => handleChange('default_confidence_threshold', parseFloat(e.target.value))}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono"
                          />
                          <span className="text-[10px] text-slate-400 mt-0.5 block">0.20 for Balanced, 0.15 for High Recall</span>
                        </div>
                        <div>
                          <label className="block text-slate-700 font-bold mb-1">NMS / IoU Matching Threshold</label>
                          <input 
                            type="number" 
                            step="0.01" 
                            min="0.10" 
                            max="0.90"
                            value={settings.default_iou_threshold}
                            onChange={e => handleChange('default_iou_threshold', parseFloat(e.target.value))}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono"
                          />
                          <span className="text-[10px] text-slate-400 mt-0.5 block">Non-Maximum Suppression threshold (0.45)</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-800 text-[11px] flex items-start gap-2">
                      <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold block">Job-Level Override Notice:</span>
                        System settings establish the initial defaults for new video processing jobs. Operators may override these parameters on a per-video basis within the Live Analysis interface.
                      </div>
                    </div>

                  </div>
                )}

                {/* TAB 2: Traffic Rules & Bounds */}
                {activeTab === 'rules' && (
                  <div className="space-y-4">
                    
                    {/* Speed Limits & Tolerance */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                      <div>
                        <span className="font-bold text-slate-900 text-xs block">Speed Regulation Parameters</span>
                        <p className="text-slate-500 text-[11px] mt-0.5">
                          Thresholds used by the rule engine to flag potential speeding events.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4 pt-1">
                        <div>
                          <label className="block text-slate-700 font-bold mb-1">Default Posted Speed Limit (km/h)</label>
                          <input 
                            type="number" 
                            min="10" 
                            max="200"
                            value={settings.speed_limit_default}
                            onChange={e => handleChange('speed_limit_default', parseInt(e.target.value))}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-700 font-bold mb-1">Enforcement Tolerance Margin (km/h)</label>
                          <input 
                            type="number" 
                            min="0" 
                            max="30"
                            value={settings.speed_tolerance_default}
                            onChange={e => handleChange('speed_tolerance_default', parseInt(e.target.value))}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Rule Enablement Checklist */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                      <span className="font-bold text-slate-900 text-xs block">Safety Exception Rules</span>
                      
                      <div className="divide-y divide-slate-200/80">
                        {[
                          { key: 'feature_speed_detection', label: 'Speed Limit Violation Rule', desc: 'Flags vehicles travelling faster than posted speed + tolerance margin.' },
                          { key: 'feature_red_light_detection', label: 'Stop Line & Signal Compliance Rule', desc: 'Detects vehicle traversal across stop line during active red signals.' },
                          { key: 'feature_lane_detection', label: 'Illegal Lane Departure Rule', desc: 'Flags hazardous swerving or crossing solid directional lane dividers.' },
                          { key: 'feature_plate_detection', label: 'Vehicle Identification & Plate Indexing', desc: 'Extracts license plate crops for evidentiary record association.' },
                        ].map(rule => (
                          <div key={rule.key} className="py-3 flex items-center justify-between first:pt-0 last:pb-0">
                            <div className="max-w-md pr-4">
                              <span className="font-bold text-slate-800 block">{rule.label}</span>
                              <span className="text-slate-500 text-[11px] mt-0.5 block">{rule.desc}</span>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer shrink-0">
                              <input 
                                type="checkbox" 
                                checked={Boolean(settings[rule.key as keyof typeof settings])}
                                onChange={e => handleChange(rule.key, e.target.checked)}
                                className="sr-only peer" 
                              />
                              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                )}

                {/* TAB 3: Data & Retention */}
                {activeTab === 'retention' && (
                  <div className="space-y-4">
                    
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                      <div>
                        <span className="font-bold text-slate-900 text-xs block">Evidence Lifecycle Policy</span>
                        <p className="text-slate-500 text-[11px] mt-0.5">
                          Configure retention periods for photographic evidence and analysis artifacts.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4 pt-1">
                        <div>
                          <label className="block text-slate-700 font-bold mb-1">Evidence Photo Snapshots (Days)</label>
                          <select
                            value={settings.evidence_retention_days}
                            onChange={e => handleChange('evidence_retention_days', parseInt(e.target.value))}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 font-medium"
                          >
                            <option value="14">14 Days</option>
                            <option value="30">30 Days (Default)</option>
                            <option value="60">60 Days</option>
                            <option value="90">90 Days</option>
                            <option value="180">180 Days</option>
                            <option value="365">1 Year (365 Days)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-slate-700 font-bold mb-1">Analysis Artifact Records (Days)</label>
                          <select
                            value={settings.artifact_retention_days}
                            onChange={e => handleChange('artifact_retention_days', parseInt(e.target.value))}
                            className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 font-medium"
                          >
                            <option value="30">30 Days</option>
                            <option value="90">90 Days (Default)</option>
                            <option value="180">180 Days</option>
                            <option value="365">365 Days</option>
                            <option value="730">2 Years (730 Days)</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <span className="font-bold text-slate-900 text-xs block">Durable Storage Tier</span>
                      <p className="text-slate-600 text-[11px] leading-relaxed">
                        Full video footage and encrypted analysis artifacts are stored securely in a private Backblaze B2 bucket, served on-demand via authenticated short-lived signed URLs.
                      </p>
                      <div className="text-[10px] text-slate-400 font-mono pt-1">
                        Storage Engine: Backblaze B2 • Access Protocol: S3-Compatible Authenticated Presigned API
                      </div>
                    </div>

                  </div>
                )}

                {/* TAB 4: Platform & Alerts */}
                {activeTab === 'platform' && (
                  <div className="space-y-4">
                    
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                      <span className="font-bold text-slate-900 text-xs block">Operational Broadcast Controls</span>
                      
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-bold text-slate-800 block">Real-Time Alert Broadcasting</span>
                            <span className="text-slate-500 text-[11px] block mt-0.5">
                              Enables live websocket event notifications when high severity incidents are identified.
                            </span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                            <input 
                              type="checkbox" 
                              checked={settings.feature_alerts}
                              onChange={e => handleChange('feature_alerts', e.target.checked)}
                              className="sr-only peer" 
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                          </label>
                        </div>

                        <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                          <div>
                            <span className="font-bold text-slate-800 block">System Maintenance Mode</span>
                            <span className="text-slate-500 text-[11px] block mt-0.5">
                              Suspends new video analysis job submissions for platform upgrades.
                            </span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                            <input 
                              type="checkbox" 
                              checked={settings.maintenance_mode}
                              onChange={e => handleChange('maintenance_mode', e.target.checked)}
                              className="sr-only peer" 
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-600"></div>
                          </label>
                        </div>
                      </div>
                    </div>

                  </div>
                )}

              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  )
}
export default Config
