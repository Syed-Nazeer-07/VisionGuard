import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { 
  Film, ShieldAlert, Activity, AlertOctagon,
  Clock, ArrowRight, ArrowUpRight,
  Loader2, Upload, Car, Truck, Bike, Bus,
  CheckCircle2, AlertTriangle, Eye, ChevronRight
} from 'lucide-react'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import type { VideoAsset, AnalysisRun } from '../services/db'
import { fallbackVideoNumbers, videoDisplayName } from '../lib/videoAssets'
import { formatDistanceToNow, format } from 'date-fns'

interface TrackedObjectSummary {
  id: string
  video_id: string | null
  track_id: number
  object_type: string
  confidence: number
  frame_count: number | null
  analysis_run_id: string | null
}

interface IncidentItem {
  id: string
  video_id: string | null
  camera_id: string | null
  incident_type: string
  severity: string | null
  description: string | null
  created_at: string
  analysis_run_id: string | null
  track_id: number | null
  cameras?: { name: string } | null
  location?: string | null
}

function getAnalysisSummary(video: VideoAsset) {
  const meta = (video.metadata && typeof video.metadata === 'object' && !Array.isArray(video.metadata) ? video.metadata : {}) as Record<string, any>;
  const vehicles = meta.unique_vehicles ?? meta.summary?.unique_vehicles ?? null;
  const frames = meta.total_frames ?? meta.processed_frames ?? meta.summary?.total_frames ?? video.frame_count ?? null;
  const incidents = meta.speed_violations_count ?? meta.summary?.speed_violations_count ?? 0;
  const profile = meta.detection_profile === 'high_recall' ? 'High Recall' : (meta.detection_profile === 'balanced' ? 'Balanced' : null);
  const speed = meta.processing_speed === 'fast' ? 'Fast (2x)' : (meta.processing_speed === 'full' ? 'Full (1x)' : null);
  return { vehicles, frames, incidents, profile, speed };
}

function formatShortDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  try {
    const diffHours = (Date.now() - d.getTime()) / (1000 * 60 * 60);
    if (diffHours < 24 && diffHours >= 0) {
      return `${Math.max(1, Math.round(diffHours))}h ago`;
    }
    return format(d, 'MMM d');
  } catch {
    return '—';
  }
}

export function Dashboard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Real persisted data states
  const [videos, setVideos] = useState<VideoAsset[]>([])
  const [runs, setRuns] = useState<AnalysisRun[]>([])
  const [trackedObjects, setTrackedObjects] = useState<TrackedObjectSummary[]>([])
  const [incidents, setIncidents] = useState<IncidentItem[]>([])

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true)
      setError(null)
      try {
        const [videosRes, runsRes, tracksRes, incidentsRes] = await Promise.all([
          supabase.from('video_assets').select('*').order('uploaded_at', { ascending: false }),
          supabase.from('analysis_runs').select('*').order('started_at', { ascending: false }).limit(20),
          supabase.from('tracked_objects').select('id, video_id, track_id, object_type, confidence, frame_count, analysis_run_id'),
          supabase.from('incidents').select('*, cameras(name)').order('created_at', { ascending: false }).limit(20)
        ])

        if (videosRes.error) console.warn('video_assets load warning:', videosRes.error)
        if (runsRes.error) console.warn('analysis_runs load warning:', runsRes.error)
        if (tracksRes.error) console.warn('tracked_objects load warning:', tracksRes.error)
        if (incidentsRes.error) console.warn('incidents load warning:', incidentsRes.error)

        setVideos((videosRes.data || []) as VideoAsset[])
        setRuns((runsRes.data || []) as AnalysisRun[])
        setTrackedObjects((tracksRes.data || []) as TrackedObjectSummary[])
        setIncidents((incidentsRes.data || []) as IncidentItem[])
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }

    loadDashboard()
  }, [])

  const fallbackNumbers = useMemo(() => fallbackVideoNumbers(videos), [videos])

  // Distinct videos with completed analysis (avoids double-counting multiple runs of the same video)
  const analyzedVideos = useMemo(() => {
    return videos.filter(v => v.processing_status === 'completed' || runs.some(r => r.video_id === v.id && r.status === 'completed'))
  }, [videos, runs])

  // Canonical traffic vehicle classes - strictly excludes person and static objects
  const TRAFFIC_VEHICLES = useMemo(() => new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle']), []);

  // Real unique vehicles count across all analyzed videos (never raw per-frame detections, never people)
  const uniqueVehiclesCount = useMemo(() => {
    const distinctTrackKeys = new Set<string>()
    trackedObjects.forEach(t => {
      const cls = (t.object_type || '').toLowerCase()
      if (TRAFFIC_VEHICLES.has(cls) && t.video_id && t.track_id !== null && t.track_id !== undefined) {
        distinctTrackKeys.add(`${t.video_id}:${t.track_id}`)
      }
    })
    if (distinctTrackKeys.size > 0) return distinctTrackKeys.size

    // Fallback: sum unique_vehicles from metadata summaries of analyzed videos
    return analyzedVideos.reduce((acc, v) => {
      const meta = (v.metadata && typeof v.metadata === 'object' && !Array.isArray(v.metadata) ? v.metadata : {}) as Record<string, any>
      const count = Number(meta.unique_vehicles ?? meta.summary?.unique_vehicles ?? 0)
      return acc + count
    }, 0)
  }, [trackedObjects, analyzedVideos, TRAFFIC_VEHICLES])

  // Total analyzed frames count
  const totalFramesAnalyzed = useMemo(() => {
    return analyzedVideos.reduce((acc, v) => {
      const meta = (v.metadata && typeof v.metadata === 'object' && !Array.isArray(v.metadata) ? v.metadata : {}) as Record<string, any>
      const count = Number(meta.total_frames ?? meta.processed_frames ?? meta.summary?.total_frames ?? v.frame_count ?? 0)
      return acc + count
    }, 0)
  }, [analyzedVideos])

  // High/critical priority incidents
  const criticalIncidentsCount = useMemo(() => {
    return incidents.filter(i => {
      const s = (i.severity || '').toLowerCase()
      return s === 'critical' || s === 'high'
    }).length
  }, [incidents])

  // Real vehicle classification distribution from tracked objects (strictly traffic vehicles)
  const vehicleClassDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    trackedObjects.forEach(t => {
      const cls = (t.object_type || '').toLowerCase()
      if (TRAFFIC_VEHICLES.has(cls)) {
        counts[cls] = (counts[cls] || 0) + 1
      }
    })

    if (Object.keys(counts).length === 0) {
      analyzedVideos.forEach(v => {
        const meta = (v.metadata && typeof v.metadata === 'object' && !Array.isArray(v.metadata) ? v.metadata : {}) as Record<string, any>
        const byClass = meta.summary?.vehicle_counts_by_class
        if (byClass && typeof byClass === 'object') {
          Object.entries(byClass).forEach(([k, val]) => {
            const cls = k.toLowerCase()
            if (TRAFFIC_VEHICLES.has(cls)) {
              counts[cls] = (counts[cls] || 0) + Number(val || 0)
            }
          })
        }
      })
    }

    const colorMap: Record<string, string> = {
      car: '#06b6d4',        // cyan
      truck: '#f59e0b',      // amber
      bus: '#10b981',        // emerald
      motorcycle: '#8b5cf6', // purple
      bicycle: '#ec4899',    // pink
      vehicle: '#64748b'
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    return Object.entries(counts).map(([name, count]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      count,
      percent: total > 0 ? Math.round((count / total) * 100) : 0,
      color: colorMap[name] || '#6366f1'
    }))
  }, [trackedObjects, analyzedVideos, TRAFFIC_VEHICLES])

  // Real traffic activity data derived from completed analysis runs
  const activityData = useMemo(() => {
    const completedRuns = [...runs]
      .filter(r => r.status === 'completed')
      .slice(0, 6)
      .reverse()

    if (completedRuns.length > 0) {
      return completedRuns.map((r, i) => {
        const vid = videos.find(v => v.id === r.video_id)
        const name = vid ? videoDisplayName(vid, fallbackNumbers) : `Run #${r.id.slice(0, 6)}`
        const timeStr = r.started_at ? format(new Date(r.started_at), 'MMM d, HH:mm') : `Run ${i + 1}`
        const vehicles = Number(
          r.metrics && typeof r.metrics === 'object' && (r.metrics as any).summary?.unique_vehicles
            ? (r.metrics as any).summary.unique_vehicles
            : trackedObjects.filter(t => t.analysis_run_id === r.id || t.video_id === r.video_id).length
        )
        const incidentsCount = Number(r.incidents_created ?? 0)
        return {
          label: name.length > 14 ? `${name.slice(0, 12)}…` : name,
          fullName: name,
          time: timeStr,
          vehicles,
          incidents: incidentsCount
        }
      })
    }

    return analyzedVideos.slice(0, 6).reverse().map((v, i) => {
      const meta = (v.metadata && typeof v.metadata === 'object' ? v.metadata : {}) as Record<string, any>
      const name = videoDisplayName(v, fallbackNumbers)
      const timeStr = v.uploaded_at ? format(new Date(v.uploaded_at), 'MMM d, HH:mm') : `Video ${i + 1}`
      const vehicles = Number(meta.unique_vehicles ?? meta.summary?.unique_vehicles ?? 0)
      const incidentsCount = Number(meta.speed_violations_count ?? meta.summary?.speed_violations_count ?? 0)
      return {
        label: name.length > 14 ? `${name.slice(0, 12)}…` : name,
        fullName: name,
        time: timeStr,
        vehicles,
        incidents: incidentsCount
      }
    })
  }, [runs, videos, analyzedVideos, trackedObjects, fallbackNumbers])

  if (loading) {
    return (
      <div className="h-[calc(100vh-136px)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-slate-500 text-xs">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
          <span>Loading traffic intelligence…</span>
        </div>
      </div>
    )
  }

  // Proper first-run onboarding empty state when no videos or incidents exist
  if (videos.length === 0 && incidents.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 flex flex-col items-center justify-center text-center max-w-3xl mx-auto my-8">
        <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-indigo-100 shadow-xs">
          <Activity className="w-8 h-8 text-indigo-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Welcome to VisionGuard Traffic Intelligence</h2>
        <p className="text-slate-600 text-sm max-w-lg mb-8 leading-relaxed">
          Your traffic surveillance platform is online and ready. Follow the 4-step workflow below to analyze footage and generate operational insights.
        </p>

        {/* 4-Step First-Run Guide Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5 text-left w-full mb-8">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-xs">1</span>
                <span className="font-bold text-xs text-slate-900">Upload Video</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Provide an MP4 or WebM highway/intersection recording in Live Analysis.
              </p>
            </div>
            <span className="text-[10px] text-indigo-600 font-semibold mt-3">Drag & drop or browse</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-xs">2</span>
                <span className="font-bold text-xs text-slate-900">Save to History</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Toggle "Save to History" to persist detections, tracks, and evidence artifacts.
              </p>
            </div>
            <span className="text-[10px] text-indigo-600 font-semibold mt-3">Enables cross-session review</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-xs">3</span>
                <span className="font-bold text-xs text-slate-900">Configure & Run</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Analyze traffic footage with YOLO11n on WebGPU or Local Backend.
              </p>
            </div>
            <span className="text-[10px] text-indigo-600 font-semibold mt-3">DirectML GPU or CPU</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-xs">4</span>
                <span className="font-bold text-xs text-slate-900">Review & Report</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Inspect incidents in Video Review, manage cases, and export PDF traffic reports.
              </p>
            </div>
            <span className="text-[10px] text-indigo-600 font-semibold mt-3">Full evidence audit trail</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link 
            to="/app/analyze"
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <Upload className="w-4 h-4" /> Start First Video Analysis
          </Link>
          <Link 
            to="/app/videos"
            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-5 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-2xs flex items-center gap-2 cursor-pointer"
          >
            <Film className="w-4 h-4 text-slate-500" /> Open Video History
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10 w-full min-w-0">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 min-w-0">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Traffic Intelligence Overview</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Operational summary of analyzed traffic footage, tracked vehicles, and recorded incidents.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link 
            to="/app/videos"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
          >
            <Film className="w-3.5 h-3.5 text-slate-500" /> Video History
          </Link>
          <Link 
            to="/app/analyze"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" /> Start Live Analysis
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3.5 py-2.5 rounded-lg text-xs flex items-center justify-between">
          <span>Failed to load some dashboard records: {error}</span>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700 font-bold ml-4">✕</button>
        </div>
      )}

      {/* Primary KPI Row — Connected to real persisted data */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 min-w-0">
        {/* Videos Analyzed */}
        <div 
          onClick={() => navigate('/app/videos')}
          className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs hover:border-indigo-300 hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Videos Analyzed</span>
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 transition-colors">
              <Film className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900 font-mono tracking-tight">{analyzedVideos.length}</div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
              <span>{videos.length} total saved videos</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 transition-colors" />
            </div>
          </div>
        </div>

        {/* Vehicles Tracked */}
        <div 
          onClick={() => navigate('/app/analytics')}
          className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs hover:border-cyan-300 hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Vehicles Tracked</span>
            <div className="p-2 rounded-lg bg-cyan-50 text-cyan-600 group-hover:bg-cyan-100 transition-colors">
              <Car className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900 font-mono tracking-tight">{uniqueVehiclesCount}</div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
              <span>Unique tracked objects</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-600 transition-colors" />
            </div>
          </div>
        </div>

        {/* Incidents Recorded */}
        <div 
          onClick={() => navigate('/app/incidents')}
          className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs hover:border-rose-300 hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Incidents Recorded</span>
            <div className="p-2 rounded-lg bg-rose-50 text-rose-600 group-hover:bg-rose-100 transition-colors">
              <AlertOctagon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-rose-600 font-mono tracking-tight">{incidents.length}</div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
              <span>{criticalIncidentsCount} high / critical priority</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-600 transition-colors" />
            </div>
          </div>
        </div>

        {/* Footage Processed */}
        <div 
          onClick={() => navigate('/app/analyze')}
          className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs hover:border-emerald-300 hover:shadow-xs transition-all cursor-pointer group flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Footage Processed</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100 transition-colors">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900 font-mono tracking-tight">{totalFramesAnalyzed.toLocaleString()}</div>
            <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
              <span>Evaluated video frames</span>
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
            </div>
          </div>
        </div>
      </div>

      {/* Middle Section: Traffic Activity & Classification Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 min-w-0">
        {/* Activity Chart (8 cols) */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 shadow-2xs p-5 flex flex-col justify-between min-w-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Traffic Analysis Activity</h3>
              <p className="text-xs text-slate-500 mt-0.5">Tracked vehicles and recorded incidents across recent completed analyses.</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 font-medium">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-600" /> Vehicles
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> Incidents
              </span>
            </div>
          </div>

          <div className="h-[240px] w-full min-w-0">
            {activityData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                No completed analyses to plot yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="label" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 11, fill: '#64748b' }} 
                    dy={5}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 11, fill: '#64748b' }} 
                    allowDecimals={false} 
                  />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: '#fff', 
                      borderRadius: '8px', 
                      border: '1px solid #e2e8f0', 
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      fontSize: '12px'
                    }}
                    labelStyle={{ fontWeight: 'bold', color: '#0f172a' }}
                    formatter={(value: any, name: any) => [
                      value, 
                      name === 'vehicles' ? 'Vehicles Tracked' : 'Incidents Flagged'
                    ]}
                  />
                  <Bar dataKey="vehicles" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="incidents" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Vehicle Classification Breakdown (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-2xs p-5 flex flex-col justify-between min-w-0">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold text-slate-900">Vehicle Classification</h3>
              <span className="text-xs font-semibold text-slate-400 font-mono">{uniqueVehiclesCount} Total</span>
            </div>
            <p className="text-xs text-slate-500 mb-4">Distribution of unique tracked vehicle types.</p>
          </div>

          <div className="space-y-3 my-auto">
            {vehicleClassDistribution.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No tracked vehicles classified yet.
              </div>
            ) : (
              vehicleClassDistribution.map((item) => {
                const IconComponent = 
                  item.name.toLowerCase() === 'car' ? Car :
                  item.name.toLowerCase() === 'truck' ? Truck :
                  item.name.toLowerCase() === 'bus' ? Bus :
                  item.name.toLowerCase() === 'motorcycle' ? Bike : Car

                return (
                  <div key={item.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                        <IconComponent className="w-3.5 h-3.5" style={{ color: item.color }} />
                        {item.name}
                      </span>
                      <span className="font-mono text-slate-500 text-[11px]">
                        {item.count} ({item.percent}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div 
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${item.percent}%`, backgroundColor: item.color }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between mt-4">
            <span>Powered by YOLO11n ONNX</span>
            <Link to="/app/videos" className="text-indigo-600 font-semibold hover:underline flex items-center gap-1">
              Inspect tracks <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom Section: Recent Analyses & Recent Incidents */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-5 items-start min-w-0">
        {/* Recent Analyses Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col min-w-0">
          <div className="p-3.5 sm:p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">Recent Video Analyses</h3>
              <p className="text-xs text-slate-500 mt-0.5 truncate">Recently submitted and completed traffic footage runs.</p>
            </div>
            <Link to="/app/videos" className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 shrink-0 ml-2">
              <span>View History</span> <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="w-full min-w-0 overflow-hidden">
            {videos.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No videos recorded in library yet.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50/70 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2">Video</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2 text-center">Vehicles</th>
                    <th className="px-2 py-2 text-center">Incidents</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {videos.slice(0, 5).map((v) => {
                    const name = videoDisplayName(v, fallbackNumbers)
                    const summary = getAnalysisSummary(v)
                    const isCompleted = v.processing_status === 'completed'

                    return (
                      <tr key={v.id} className="hover:bg-slate-50/60 transition-colors">
                        {/* Video Name and Filename */}
                        <td className="px-3 py-2 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                              <Film className="w-3 h-3 text-slate-500" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-900 text-xs truncate" title={name}>{name}</p>
                              <p className="text-[10px] text-slate-400 truncate max-w-[130px] sm:max-w-[180px]" title={v.filename}>{v.filename}</p>
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-2 py-2 shrink-0 whitespace-nowrap">
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-semibold border inline-flex items-center gap-1",
                            isCompleted 
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : v.processing_status === 'processing' || v.processing_status === 'analyzing'
                              ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                              : "bg-slate-100 text-slate-600 border-slate-200"
                          )}>
                            {isCompleted ? <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600 shrink-0" /> : null}
                            <span>{isCompleted ? 'Done' : (v.processing_status || 'Pending')}</span>
                          </span>
                        </td>

                        {/* Vehicle Count */}
                        <td className="px-2 py-2 text-center font-mono text-slate-700 text-xs shrink-0 whitespace-nowrap">
                          {summary.vehicles !== null ? summary.vehicles : '—'}
                        </td>

                        {/* Incident Count */}
                        <td className="px-2 py-2 text-center font-mono text-xs shrink-0 whitespace-nowrap">
                          {summary.incidents > 0 ? (
                            <span className="text-rose-600 font-semibold">{summary.incidents}</span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>

                        {/* Short Date */}
                        <td className="px-2 py-2 text-slate-500 text-[11px] shrink-0 whitespace-nowrap">
                          {formatShortDate(v.uploaded_at)}
                        </td>

                        {/* Compact Action */}
                        <td className="px-3 py-2 text-right shrink-0 whitespace-nowrap">
                          {isCompleted ? (
                            <button
                              onClick={() => navigate(`/app/videos?video=${encodeURIComponent(v.id)}`)}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-white hover:bg-slate-50 text-indigo-700 border border-indigo-200 rounded text-[11px] font-semibold transition-colors cursor-pointer shadow-2xs shrink-0"
                              title="Open in History"
                            >
                              <Eye className="w-3 h-3" />
                              <span>Review</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => navigate(`/app/analyze?video=${encodeURIComponent(v.id)}`)}
                              className="inline-flex items-center px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-medium transition-colors cursor-pointer shadow-2xs shrink-0"
                            >
                              Analyze
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Recent Incidents Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col min-w-0">
          <div className="p-3.5 sm:p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 truncate">Recent Incidents</h3>
              <p className="text-xs text-slate-500 mt-0.5 truncate">Recorded traffic events and infractions.</p>
            </div>
            <Link to="/app/incidents" className="text-xs font-semibold text-rose-600 hover:text-rose-700 flex items-center gap-1 shrink-0 ml-2">
              <span>Incident Center</span> <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="w-full min-w-0 overflow-hidden">
            {incidents.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No incidents recorded.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50/70 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-2 py-2">Incident</th>
                    <th className="px-2 py-2">Source</th>
                    <th className="px-3 py-2 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {incidents.slice(0, 5).map((inc) => {
                    const isCritical = inc.severity === 'Critical' || inc.severity === 'high'
                    const isMedium = inc.severity === 'Medium' || inc.severity === 'medium'
                    const matchedVideo = inc.video_id ? videos.find(v => v.id === inc.video_id) : null
                    const locationLabel = matchedVideo 
                      ? videoDisplayName(matchedVideo, fallbackNumbers) 
                      : inc.cameras?.name || inc.location || 'Traffic Feed'

                    return (
                      <tr 
                        key={inc.id}
                        onClick={() => {
                          if (inc.id) {
                            navigate(`/app/incidents?id=${inc.id}`)
                          } else if (inc.video_id) {
                            navigate(`/app/videos?video=${encodeURIComponent(inc.video_id)}`)
                          } else {
                            navigate('/app/incidents')
                          }
                        }}
                        className="hover:bg-slate-50/60 transition-colors cursor-pointer group"
                      >
                        {/* Severity */}
                        <td className="px-3 py-2 shrink-0 whitespace-nowrap">
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border",
                            isCritical 
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : isMedium 
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-blue-50 text-blue-700 border-blue-200"
                          )}>
                            {inc.severity || 'Medium'}
                          </span>
                        </td>

                        {/* Incident Type */}
                        <td className="px-2 py-2 font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors min-w-0">
                          <span className="truncate block max-w-[110px] sm:max-w-[140px]" title={String(inc.incident_type || 'Traffic Violation').replace(/_/g, ' ')}>
                            {String(inc.incident_type || 'Traffic Violation').replace(/_/g, ' ')}
                          </span>
                        </td>

                        {/* Source Video / Camera */}
                        <td className="px-2 py-2 text-slate-600 font-medium text-[11px] min-w-0">
                          <span className="truncate block max-w-[90px] sm:max-w-[120px]" title={locationLabel}>
                            {locationLabel}
                          </span>
                        </td>

                        {/* Short Time */}
                        <td className="px-3 py-2 text-right text-slate-400 text-[11px] shrink-0 whitespace-nowrap">
                          {formatShortDate(inc.created_at)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
