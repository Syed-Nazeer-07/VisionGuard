import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { 
  BarChart3, Activity, Download, Loader2,
  Calendar, ShieldAlert, AlertTriangle, Car, Truck, Bus, Bike,
  Film, RotateCcw, Filter, Eye, ChevronRight, CheckCircle2,
  Clock, ArrowUpRight, AlertOctagon, Upload, FolderOpen, Shield
} from 'lucide-react'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import type { VideoAsset, AnalysisRun } from '../services/db'
import { fallbackVideoNumbers, formatBytes, videoDisplayName } from '../lib/videoAssets'
import { subDays, startOfDay, format, formatDistanceToNow } from 'date-fns'

type DateRange = 'all' | 'today' | '7d' | '30d'

interface TrackedObjectRow {
  id: string
  video_id: string | null
  track_id: number
  object_type: string
  confidence: number
  frame_count: number | null
  analysis_run_id: string | null
  created_at?: string
  metadata?: any
}

interface IncidentRow {
  id: string
  video_id: string | null
  camera_id: string | null
  incident_type: string
  severity: string | null
  status?: string | null
  resolved_at?: string | null
  description: string | null
  created_at: string
  analysis_run_id: string | null
  track_id: number | null
  cameras?: { name: string } | null
  location?: string | null
}

interface CaseRow {
  id: string
  incident_id?: string | null
  status: string
  created_at: string
}

function getRunMetadata(run: AnalysisRun) {
  const m = (run.metrics && typeof run.metrics === 'object' && !Array.isArray(run.metrics) ? run.metrics : {}) as Record<string, any>
  const profile = m.detection_profile === 'high_recall' ? 'High Recall' : (m.detection_profile === 'balanced' ? 'Balanced' : 'Balanced')
  const speed = m.processing_speed === 'fast' ? 'Fast (2x)' : (m.processing_speed === 'full' ? 'Full (1x)' : 'Full (1x)')
  const uniqueVehicles = m.summary?.unique_vehicles ?? null
  const durationSeconds = m.summary?.duration_seconds ?? null
  const avgSpeed = m.summary?.average_speed_kmh ?? null
  return { profile, speed, uniqueVehicles, durationSeconds, avgSpeed, summary: m.summary }
}

export default function Analytics() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Real persisted datasets
  const [videos, setVideos] = useState<VideoAsset[]>([])
  const [runs, setRuns] = useState<AnalysisRun[]>([])
  const [trackedObjects, setTrackedObjects] = useState<TrackedObjectRow[]>([])
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [cases, setCases] = useState<CaseRow[]>([])

  // Functional filter controls
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const [selectedScope, setSelectedScope] = useState<string>('all') // 'all' | 'video:ID' | 'run:ID'
  const [selectedVehicleClass, setSelectedVehicleClass] = useState<string>('all') // 'all' | 'car' | 'truck' | 'bus' | 'motorcycle'
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all') // 'all' | 'Critical' | 'High' | 'Medium' | 'Low'
  const [selectedIncidentType, setSelectedIncidentType] = useState<string>('all') // 'all' | string

  useEffect(() => {
    async function loadAnalyticsData() {
      setLoading(true)
      setError(null)
      try {
        const [videosRes, runsRes, tracksRes, incRes, casesRes] = await Promise.all([
          supabase.from('video_assets').select('*').order('uploaded_at', { ascending: false }),
          supabase.from('analysis_runs').select('*').order('started_at', { ascending: false }),
          supabase.from('tracked_objects').select('id, video_id, track_id, object_type, confidence, frame_count, analysis_run_id, created_at, metadata'),
          supabase.from('incidents').select('*, cameras(name)').order('created_at', { ascending: false }),
          supabase.from('cases').select('*').order('created_at', { ascending: false })
        ])

        if (videosRes.error) console.warn('video_assets load error:', videosRes.error)
        if (runsRes.error) console.warn('analysis_runs load error:', runsRes.error)
        if (tracksRes.error) console.warn('tracked_objects load error:', tracksRes.error)
        if (incRes.error) console.warn('incidents load error:', incRes.error)
        if (casesRes.error) console.warn('cases load error:', casesRes.error)

        setVideos((videosRes.data || []) as VideoAsset[])
        setRuns((runsRes.data || []) as AnalysisRun[])
        setTrackedObjects((tracksRes.data || []) as TrackedObjectRow[])
        setIncidents((incRes.data || []) as IncidentRow[])
        setCases((casesRes.data || []) as CaseRow[])
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }

    loadAnalyticsData()
  }, [])

  const fallbackNumbers = useMemo(() => fallbackVideoNumbers(videos), [videos])

  // Completed videos
  const completedVideos = useMemo(() => {
    return videos.filter(v => v.processing_status === 'completed' || runs.some(r => r.video_id === v.id && r.status === 'completed'))
  }, [videos, runs])

  // Map each video to its latest completed run (prevents inflating metrics by combining multiple runs of the same video)
  const latestRunPerVideo = useMemo(() => {
    const map = new Map<string, AnalysisRun>()
    runs.forEach(r => {
      if (r.video_id && r.status === 'completed') {
        const existing = map.get(r.video_id)
        if (!existing || new Date(r.started_at) > new Date(existing.started_at)) {
          map.set(r.video_id, r)
        }
      }
    })
    return map
  }, [runs])

  // Date range cutoff calculation
  const dateCutoff = useMemo(() => {
    const now = new Date()
    if (dateRange === 'today') return startOfDay(now)
    if (dateRange === '7d') return subDays(now, 7)
    if (dateRange === '30d') return subDays(now, 30)
    return null
  }, [dateRange])

  // Filtered runs according to date range and scope selection policy
  const scopedRuns = useMemo(() => {
    return runs.filter(r => {
      if (r.status !== 'completed') return false
      if (dateCutoff && new Date(r.started_at) < dateCutoff) return false

      if (selectedScope.startsWith('run:')) {
        return r.id === selectedScope.slice(4)
      }
      if (selectedScope.startsWith('video:')) {
        return r.video_id === selectedScope.slice(6)
      }
      // When 'all', use the latest completed run per video to avoid double-counting repeat runs
      if (r.video_id) {
        const latest = latestRunPerVideo.get(r.video_id)
        return latest?.id === r.id
      }
      return true
    })
  }, [runs, dateCutoff, selectedScope, latestRunPerVideo])

  // Set of active scoped video IDs
  const scopedVideoIds = useMemo(() => {
    if (selectedScope.startsWith('video:')) return new Set([selectedScope.slice(6)])
    if (selectedScope.startsWith('run:')) {
      const runId = selectedScope.slice(4)
      const r = runs.find(x => x.id === runId)
      return new Set(r?.video_id ? [r.video_id] : [])
    }
    return new Set(scopedRuns.map(r => r.video_id).filter((id): id is string => Boolean(id)))
  }, [selectedScope, scopedRuns, runs])

  // Scoped & Filtered Tracked Objects
  const scopedTrackedObjects = useMemo(() => {
    const targetRunIds = new Set(scopedRuns.map(r => r.id))

    return trackedObjects.filter(t => {
      // Must match scope
      if (selectedScope.startsWith('run:')) {
        if (t.analysis_run_id !== selectedScope.slice(4)) return false
      } else if (selectedScope.startsWith('video:')) {
        const vid = selectedScope.slice(6)
        if (t.video_id !== vid) return false
        const latestRun = latestRunPerVideo.get(vid)
        if (latestRun && t.analysis_run_id && t.analysis_run_id !== latestRun.id) return false
      } else {
        // 'all': match latest run of scoped videos
        if (t.analysis_run_id && !targetRunIds.has(t.analysis_run_id)) return false
        if (t.video_id && !scopedVideoIds.has(t.video_id)) return false
      }

      // Vehicle class filter: strictly restrict to traffic vehicle classes (car, truck, bus, motorcycle, bicycle)
      const normClass = (t.object_type || '').toLowerCase();
      if (!['car', 'truck', 'bus', 'motorcycle', 'bicycle'].includes(normClass)) {
        return false;
      }
      if (selectedVehicleClass !== 'all' && normClass !== selectedVehicleClass.toLowerCase()) {
        return false;
      }

      return true
    })
  }, [trackedObjects, scopedRuns, selectedScope, scopedVideoIds, latestRunPerVideo, selectedVehicleClass])

  // Distinct Unique Vehicles Tracked (strict count of distinct track entities, never frame detections)
  const uniqueVehiclesCount = useMemo(() => {
    const trackSet = new Set<string>()
    scopedTrackedObjects.forEach(t => {
      if (t.video_id && t.track_id !== null && t.track_id !== undefined) {
        trackSet.add(`${t.video_id}:${t.track_id}`)
      }
    })
    if (trackSet.size > 0) return trackSet.size

    // Fallback to metadata summary on scoped runs
    if (selectedVehicleClass === 'all') {
      return scopedRuns.reduce((acc, r) => {
        const meta = getRunMetadata(r)
        return acc + (meta.uniqueVehicles || 0)
      }, 0)
    }
    return 0
  }, [scopedTrackedObjects, scopedRuns, selectedVehicleClass])

  // Scoped & Filtered Incidents
  const scopedIncidents = useMemo(() => {
    const targetRunIds = new Set(scopedRuns.map(r => r.id))

    return incidents.filter(inc => {
      if (dateCutoff && new Date(inc.created_at) < dateCutoff) return false

      // Scope filter
      if (selectedScope.startsWith('run:')) {
        if (inc.analysis_run_id !== selectedScope.slice(4)) return false
      } else if (selectedScope.startsWith('video:')) {
        if (inc.video_id !== selectedScope.slice(6)) return false
      } else {
        // 'all': if incident has video_id, check if that video is in scoped videos
        if (inc.video_id && !scopedVideoIds.has(inc.video_id)) return false
        if (inc.analysis_run_id && !targetRunIds.has(inc.analysis_run_id)) return false
      }

      // Severity filter
      if (selectedSeverity !== 'all' && (inc.severity || '').toLowerCase() !== selectedSeverity.toLowerCase()) {
        return false
      }

      // Incident type filter
      if (selectedIncidentType !== 'all' && (inc.incident_type || '') !== selectedIncidentType) {
        return false
      }

      return true
    })
  }, [incidents, dateCutoff, selectedScope, scopedRuns, scopedVideoIds, selectedSeverity, selectedIncidentType])

  // Total analyzed frames count
  const totalFramesAnalyzed = useMemo(() => {
    return scopedRuns.reduce((acc, r) => acc + (r.frames_processed || 0), 0)
  }, [scopedRuns])

  // Total video duration in seconds
  const totalDurationSeconds = useMemo(() => {
    let secs = 0
    scopedRuns.forEach(r => {
      const meta = getRunMetadata(r)
      if (meta.durationSeconds) secs += meta.durationSeconds
      else if (r.video_id) {
        const v = videos.find(x => x.id === r.video_id)
        if (v?.duration) secs += v.duration
      }
    })
    return secs
  }, [scopedRuns, videos])

  // Vehicle classification distribution from actual tracked objects (strictly traffic vehicles)
  const vehicleClassDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    scopedTrackedObjects.forEach(t => {
      const cls = (t.object_type || '').toLowerCase()
      if (['car', 'truck', 'bus', 'motorcycle', 'bicycle'].includes(cls)) {
        counts[cls] = (counts[cls] || 0) + 1
      }
    })

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
      rawName: name,
      count,
      percent: total > 0 ? Math.round((count / total) * 100) : 0,
      color: colorMap[name] || '#6366f1'
    }))
  }, [scopedTrackedObjects])

  // Severity breakdown counts
  const severityBreakdown = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 }
    scopedIncidents.forEach(inc => {
      const s = (inc.severity || '').toLowerCase()
      if (s === 'critical') counts.critical++
      else if (s === 'high') counts.high++
      else if (s === 'medium') counts.medium++
      else counts.low++
    })
    return counts
  }, [scopedIncidents])

  // Distinct incident types for filter dropdown
  const allIncidentTypes = useMemo(() => {
    const set = new Set<string>()
    incidents.forEach(i => {
      if (i.incident_type) set.add(i.incident_type)
    })
    return Array.from(set).sort()
  }, [incidents])

  // Chart data: chronological series of scoped runs and incidents
  const chartData = useMemo(() => {
    const sortedRuns = [...scopedRuns].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())

    if (sortedRuns.length > 0) {
      return sortedRuns.map((r, i) => {
        const vid = videos.find(v => v.id === r.video_id)
        const name = vid ? videoDisplayName(vid, fallbackNumbers) : `Run #${r.id.slice(0, 6)}`
        const timeStr = r.started_at ? format(new Date(r.started_at), 'MMM d, HH:mm') : `Run ${i + 1}`
        
        // Count scoped tracks and incidents for this run
        const runTracks = scopedTrackedObjects.filter(t => t.analysis_run_id === r.id || (!t.analysis_run_id && t.video_id === r.video_id))
        const vehicles = runTracks.length > 0 ? runTracks.length : (getRunMetadata(r).uniqueVehicles || 0)
        const runIncidents = scopedIncidents.filter(inc => inc.analysis_run_id === r.id || (!inc.analysis_run_id && inc.video_id === r.video_id))

        return {
          id: r.id,
          videoId: r.video_id,
          label: name.length > 14 ? `${name.slice(0, 12)}…` : name,
          fullName: name,
          time: timeStr,
          vehicles,
          incidents: runIncidents.length,
          profile: getRunMetadata(r).profile,
          fps: r.fps || 0
        }
      })
    }

    return []
  }, [scopedRuns, videos, fallbackNumbers, scopedTrackedObjects, scopedIncidents])

  // Reset all filters
  const resetFilters = () => {
    setDateRange('all')
    setSelectedScope('all')
    setSelectedVehicleClass('all')
    setSelectedSeverity('all')
    setSelectedIncidentType('all')
  }

  const hasActiveFilters = dateRange !== 'all' || selectedScope !== 'all' || selectedVehicleClass !== 'all' || selectedSeverity !== 'all' || selectedIncidentType !== 'all'

  // Export filtered analytics to CSV
  const handleExportCSV = () => {
    if (scopedRuns.length === 0 && scopedIncidents.length === 0) {
      alert('No data available to export for current filter criteria.')
      return
    }

    const rows: string[][] = [
      ['VisionGuard Traffic Analytics Report'],
      [`Generated at: ${new Date().toISOString()}`],
      [`Scope: ${selectedScope}`, `Date Range: ${dateRange}`, `Vehicle Class Filter: ${selectedVehicleClass}`, `Severity Filter: ${selectedSeverity}`],
      [],
      ['ANALYZED RUNS & FOOTAGE'],
      ['Run ID', 'Video Name', 'Date Started', 'Status', 'FPS', 'Frames Processed', 'Vehicles Tracked', 'Incidents Count'],
      ...scopedRuns.map(r => {
        const v = videos.find(x => x.id === r.video_id)
        const name = v ? videoDisplayName(v, fallbackNumbers) : 'Unknown'
        return [
          r.id,
          name,
          r.started_at,
          r.status,
          String(r.fps || ''),
          String(r.frames_processed || ''),
          String(getRunMetadata(r).uniqueVehicles || ''),
          String(r.incidents_created || 0)
        ]
      }),
      [],
      ['RECORDED INCIDENTS'],
      ['Incident ID', 'Type', 'Severity', 'Created At', 'Video ID', 'Description'],
      ...scopedIncidents.map(inc => [
        inc.id,
        inc.incident_type,
        inc.severity || '',
        inc.created_at,
        inc.video_id || '',
        inc.description || ''
      ])
    ]

    const csvContent = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `VisionGuard_Analytics_${format(new Date(), 'yyyy-MM-dd')}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // --------------------------------------------------------------------------
  // Executive Governance & Operational Resolution Metrics
  // --------------------------------------------------------------------------
  const executiveMetrics = useMemo(() => {
    const resolved = incidents.filter(i => i.status === 'Resolved').length
    const rejected = incidents.filter(i => i.status === 'Rejected').length
    const totalInc = incidents.length
    const totalDecisions = resolved + rejected
    const resolutionRatePct = totalInc > 0 ? Math.round((totalDecisions / totalInc) * 100) : 0

    // MTTR calculation using real timestamps
    let totalHours = 0
    let validDurationCount = 0
    incidents.forEach(i => {
      if (i.status === 'Resolved' && i.resolved_at && i.created_at) {
        const ms = new Date(i.resolved_at).getTime() - new Date(i.created_at).getTime()
        const hrs = ms / (1000 * 60 * 60)
        if (hrs >= 0) {
          totalHours += hrs
          validDurationCount++
        }
      }
    })
    const avgMttrStr = validDurationCount > 0
      ? (totalHours / validDurationCount < 1 ? '< 1 hr' : `${(totalHours / validDurationCount).toFixed(1)} hrs`)
      : 'N/A'

    // Backlog & cases
    const unresolvedIncidents = incidents.filter(i => i.status !== 'Resolved' && i.status !== 'Rejected')
    const activeCases = cases.filter(c => c.status === 'New' || c.status === 'Investigating' || c.status === 'Escalated')
    const escalatedCases = cases.filter(c => c.status === 'Escalated')

    // Severity
    const critHighCount = incidents.filter(i => {
      const s = (i.severity || '').toLowerCase()
      return s === 'critical' || s === 'high'
    }).length
    const critHighPct = totalInc > 0 ? Math.round((critHighCount / totalInc) * 100) : 0

    // Briefing text
    let briefingText = ''
    if (videos.length === 0 && totalInc === 0) {
      briefingText = 'No traffic footage or incidents recorded yet. Analyze video footage to unlock live operational intelligence and governance telemetry.'
    } else {
      briefingText = `Traffic network governance currently encompasses ${videos.length} video source${videos.length === 1 ? '' : 's'} and ${trackedObjects.length.toLocaleString()} detected vehicles. Across ${totalInc} recorded infractions, ${critHighCount} (${critHighPct}%) are classified as critical or high priority. Operational resolution efficiency stands at ${resolutionRatePct}%, with an average MTTR of ${avgMttrStr}. Currently, ${unresolvedIncidents.length} pending infractions require verification in the Review Queue, and ${activeCases.length} active investigation case${activeCases.length === 1 ? '' : 's'} are in progress.`
    }

    return {
      resolved,
      rejected,
      totalInc,
      resolutionRatePct,
      avgMttrStr,
      unresolvedCount: unresolvedIncidents.length,
      activeCasesCount: activeCases.length,
      escalatedCasesCount: escalatedCases.length,
      critHighCount,
      critHighPct,
      briefingText
    }
  }, [incidents, cases, videos, trackedObjects])

  if (loading) {
    return (
      <div className="h-[calc(100vh-136px)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-slate-500 text-xs">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
          <span>Aggregating persisted traffic analytics…</span>
        </div>
      </div>
    )
  }

  // Global Empty State when no videos or runs exist
  if (completedVideos.length === 0 && incidents.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 flex flex-col items-center justify-center text-center max-w-2xl mx-auto my-12">
        <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-indigo-100 shadow-xs">
          <BarChart3 className="w-8 h-8 text-indigo-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">No Traffic Analytics Available</h2>
        <p className="text-slate-500 text-sm max-w-md mb-8 leading-relaxed">
          Traffic intelligence reports and classification trends require analyzed video footage. Upload and analyze a video in Live Analysis with <strong>Save video to History</strong> enabled to populate your traffic analytics.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link 
            to="/app/analyze"
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <Upload className="w-4 h-4" /> Upload & Analyze Video
          </Link>
          <Link 
            to="/app/videos"
            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-5 py-2.5 rounded-xl text-xs font-semibold transition-all shadow-2xs flex items-center gap-2 cursor-pointer"
          >
            <Film className="w-4 h-4 text-slate-500" /> Open History
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Traffic Analytics & Strategic Intelligence</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Statistical insights, executive governance, resolution metrics, and operational traffic trends.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/app/reports"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
          >
            <span>Reports</span>
          </Link>
          <Link
            to="/app/incidents"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-blue-500" />
            <span>Incidents</span>
          </Link>
          <button 
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
            title="Export filtered records to CSV"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" /> Export CSV
          </button>
          <Link 
            to="/app/analyze"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" /> Start New Analysis
          </Link>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3.5 py-2.5 rounded-lg text-xs flex items-center justify-between">
          <span>Failed to load some analytics records: {error}</span>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700 font-bold ml-4">✕</button>
        </div>
      )}

      {/* Functional Filters Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <Filter className="w-3.5 h-3.5 text-indigo-600" />
            <span>Analytics Filters</span>
          </div>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-800 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> Reset Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          {/* 1. Date Range Filter */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Date Range
            </label>
            <select
              value={dateRange}
              onChange={e => setDateRange(e.target.value as DateRange)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
            >
              <option value="all">All Time</option>
              <option value="today">Today (24h)</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>

          {/* 2. Analysis Scope Filter (Distinguishes Runs of the same video) */}
          <div className="lg:col-span-2">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Video / Run Scope
            </label>
            <select
              value={selectedScope}
              onChange={e => setSelectedScope(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium truncate"
            >
              <option value="all">All Videos (Latest completed run per video)</option>
              {completedVideos.map(v => {
                const name = videoDisplayName(v, fallbackNumbers)
                const vRuns = runs.filter(r => r.video_id === v.id && r.status === 'completed')
                return (
                  <optgroup key={v.id} label={`${name} (${vRuns.length} runs)`}>
                    <option value={`video:${v.id}`}>Latest Completed Run for {name}</option>
                    {vRuns.map(r => {
                      const meta = getRunMetadata(r)
                      const timeStr = r.started_at ? format(new Date(r.started_at), 'MMM d, HH:mm') : 'Run'
                      return (
                        <option key={r.id} value={`run:${r.id}`}>
                          Run #{r.id.slice(0, 6)} ({meta.profile} • {meta.speed} • {timeStr})
                        </option>
                      )
                    })}
                  </optgroup>
                )
              })}
            </select>
          </div>

          {/* 3. Vehicle Class Filter */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Vehicle Class
            </label>
            <select
              value={selectedVehicleClass}
              onChange={e => setSelectedVehicleClass(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
            >
              <option value="all">All Vehicle Classes</option>
              <option value="car">Cars only</option>
              <option value="truck">Trucks only</option>
              <option value="bus">Buses only</option>
              <option value="motorcycle">Motorcycles only</option>
            </select>
          </div>

          {/* 4. Incident Severity Filter */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Incident Severity
            </label>
            <select
              value={selectedSeverity}
              onChange={e => setSelectedSeverity(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
            >
              <option value="all">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
      </div>

      {/* Executive Intelligence & Strategic Governance */}
      <div className="bg-slate-900 rounded-xl p-5 text-white shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight text-slate-100">
                Executive Intelligence & Strategic Governance
              </h2>
              <p className="text-[11px] text-slate-400">
                Consolidated operational telemetry, MTTR, and incident resolution backlog.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/app/incidents?tab=review"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-colors"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>Review Queue ({executiveMetrics.unresolvedCount})</span>
            </Link>
            <Link
              to="/app/cases"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Active Cases ({executiveMetrics.activeCasesCount})</span>
            </Link>
          </div>
        </div>

        {/* Executive Summary Narrative */}
        <p className="text-xs text-slate-300 leading-relaxed font-normal bg-slate-800/50 p-3 rounded-lg border border-slate-700/60">
          {executiveMetrics.briefingText}
        </p>

        {/* 4 Executive Metric Badges */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Resolution Rate</div>
            <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
              {executiveMetrics.resolutionRatePct}%
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {executiveMetrics.resolved + executiveMetrics.rejected} of {executiveMetrics.totalInc} resolved
            </div>
          </div>

          <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Mean Time to Resolve (MTTR)</div>
            <div className="text-xl font-bold font-mono text-indigo-400 mt-0.5">
              {executiveMetrics.avgMttrStr}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Incident creation to closure
            </div>
          </div>

          <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Verification Backlog</div>
            <div className="text-xl font-bold font-mono text-amber-400 mt-0.5">
              {executiveMetrics.unresolvedCount}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Pending in Review Queue
            </div>
          </div>

          <div className="p-3 bg-slate-800/80 rounded-lg border border-slate-700">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Active Investigations</div>
            <div className="text-xl font-bold font-mono text-blue-400 mt-0.5">
              {executiveMetrics.activeCasesCount}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {executiveMetrics.escalatedCasesCount} escalated priority
            </div>
          </div>
        </div>
      </div>

      {/* Section A: Traffic Overview KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Unique Tracked Vehicles */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Unique Vehicles</span>
            <div className="p-2 rounded-lg bg-cyan-50 text-cyan-600">
              <Car className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900 font-mono tracking-tight">{uniqueVehiclesCount}</div>
            <div className="text-[11px] text-slate-400 mt-1">
              {selectedVehicleClass !== 'all' ? `Filtered by ${selectedVehicleClass}` : 'Distinct tracked entities'}
            </div>
          </div>
        </div>

        {/* KPI 2: Total Analyzed Footage */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Analyzed Footage</span>
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <Film className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-slate-900 font-mono tracking-tight">
              {totalDurationSeconds > 0 ? `${Math.round(totalDurationSeconds)}s` : `${totalFramesAnalyzed.toLocaleString()} frames`}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {totalFramesAnalyzed.toLocaleString()} frames evaluated
            </div>
          </div>
        </div>

        {/* KPI 3: Incidents Recorded */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Recorded Incidents</span>
            <div className="p-2 rounded-lg bg-rose-50 text-rose-600">
              <AlertOctagon className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold text-rose-600 font-mono tracking-tight">{scopedIncidents.length}</div>
            <div className="text-[11px] text-slate-400 mt-1">
              {severityBreakdown.critical + severityBreakdown.high} critical / high priority
            </div>
          </div>
        </div>

        {/* KPI 4: Active Scope & Policy */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Active Scope</span>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-sm font-bold text-slate-900 truncate">
              {selectedScope.startsWith('run:') 
                ? `Run #${selectedScope.slice(4, 10)}`
                : selectedScope.startsWith('video:')
                ? 'Single Video Scope'
                : `${scopedRuns.length} Scoped Runs`}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              YOLO11n ONNX • DirectML / CPU
            </div>
          </div>
        </div>
      </div>

      {/* Section B & C: Activity Over Time & Vehicle Classification */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Section B: Vehicle Activity Over Time (8 cols) */}
        <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 shadow-2xs p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Vehicle Activity & Infraction Trends</h3>
              <p className="text-xs text-slate-500 mt-0.5">Chronological comparison of vehicles tracked and incidents detected.</p>
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

          <div className="h-[250px] w-full">
            {chartData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-xs text-slate-400">
                <Calendar className="w-8 h-8 opacity-30 mb-1" />
                <span>No analysis data points match the current filters.</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                      name === 'vehicles' ? 'Unique Vehicles' : 'Incidents Flagged'
                    ]}
                  />
                  <Bar 
                    dataKey="vehicles" 
                    fill="#4f46e5" 
                    radius={[4, 4, 0, 0]} 
                    maxBarSize={40} 
                    cursor="pointer"
                    onClick={(entry: any) => {
                      if (entry?.videoId) navigate(`/app/videos?video=${encodeURIComponent(entry.videoId)}`)
                    }}
                  />
                  <Bar 
                    dataKey="incidents" 
                    fill="#f43f5e" 
                    radius={[4, 4, 0, 0]} 
                    maxBarSize={40} 
                    cursor="pointer"
                    onClick={(entry: any) => {
                      if (entry?.videoId) navigate(`/app/videos?video=${encodeURIComponent(entry.videoId)}`)
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Section C: Vehicle Classification Distribution (4 cols) */}
        <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200 shadow-2xs p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold text-slate-900">Vehicle Classification</h3>
              <span className="text-xs font-semibold text-slate-400 font-mono">{uniqueVehiclesCount} Tracked</span>
            </div>
            <p className="text-xs text-slate-500 mb-4">Actual tracked vehicles categorized by YOLO11n.</p>
          </div>

          <div className="space-y-3 my-auto">
            {vehicleClassDistribution.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No tracked vehicle classes in selected scope.
              </div>
            ) : (
              vehicleClassDistribution.map((item) => {
                const IconComponent = 
                  item.rawName === 'car' ? Car :
                  item.rawName === 'truck' ? Truck :
                  item.rawName === 'bus' ? Bus :
                  item.rawName === 'motorcycle' ? Bike : Car

                const isSelected = selectedVehicleClass.toLowerCase() === item.rawName

                return (
                  <div 
                    key={item.name} 
                    onClick={() => setSelectedVehicleClass(isSelected ? 'all' : item.rawName)}
                    className={cn(
                      "p-1.5 rounded-lg transition-colors cursor-pointer space-y-1",
                      isSelected ? "bg-slate-100 ring-1 ring-slate-300" : "hover:bg-slate-50"
                    )}
                    title={`Click to filter by ${item.name}`}
                  >
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
            <span>Click class to filter view</span>
            {selectedVehicleClass !== 'all' && (
              <button onClick={() => setSelectedVehicleClass('all')} className="text-indigo-600 font-semibold hover:underline">
                Clear filter
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Section D: Incident Analysis */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Incident & Infraction Analysis</h3>
            <p className="text-xs text-slate-500 mt-0.5">Persisted traffic violations breakdown and recent events.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-rose-50 text-rose-700 border border-rose-200">
              Critical: {severityBreakdown.critical}
            </span>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-orange-50 text-orange-700 border border-orange-200">
              High: {severityBreakdown.high}
            </span>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-amber-50 text-amber-700 border border-amber-200">
              Medium: {severityBreakdown.medium}
            </span>
            <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-blue-50 text-blue-700 border border-blue-200">
              Low: {severityBreakdown.low}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          {scopedIncidents.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No incidents recorded for current filter criteria.
            </div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
              <thead className="bg-slate-50/70 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5">Severity</th>
                  <th className="px-3 py-2.5">Incident Type</th>
                  <th className="px-3 py-2.5">Source / Video</th>
                  <th className="px-3 py-2.5">Timestamp</th>
                  <th className="px-4 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scopedIncidents.slice(0, 6).map((inc) => {
                  const isCritical = inc.severity === 'Critical' || inc.severity === 'high'
                  const isMedium = inc.severity === 'Medium' || inc.severity === 'medium'
                  const matchedVideo = inc.video_id ? videos.find(v => v.id === inc.video_id) : null
                  const locationLabel = matchedVideo 
                    ? videoDisplayName(matchedVideo, fallbackNumbers) 
                    : inc.cameras?.name || inc.location || 'Traffic Feed'

                  return (
                    <tr key={inc.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                          isCritical 
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : isMedium 
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-blue-50 text-blue-700 border-blue-200"
                        )}>
                          {inc.severity || 'Medium'}
                        </span>
                      </td>
                      <td className="px-3 py-3 font-semibold text-slate-900">
                        {String(inc.incident_type || 'Traffic Violation').replace(/_/g, ' ')}
                      </td>
                      <td className="px-3 py-3 text-slate-600 font-medium truncate max-w-[160px]" title={locationLabel}>
                        {locationLabel}
                      </td>
                      <td className="px-3 py-3 text-slate-400 text-[11px]">
                        {inc.created_at ? `${formatDistanceToNow(new Date(inc.created_at))} ago` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {inc.video_id ? (
                          <button
                            onClick={() => navigate(`/app/videos?video=${encodeURIComponent(inc.video_id!)}`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-indigo-700 border border-indigo-200 rounded-md text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                          >
                            <Eye className="w-3.5 h-3.5" /> Review
                          </button>
                        ) : (
                          <button
                            onClick={() => navigate('/app/incidents')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-md text-xs font-medium transition-colors cursor-pointer shadow-2xs"
                          >
                            Details
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

      {/* Section E: Analysis History and Run Comparison Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Analysis Runs & History Comparison</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Inspect separate runs of the same video without combined detection inflation.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-500 font-mono">
            {scopedRuns.length} Runs Evaluated
          </span>
        </div>

        <div className="overflow-x-auto">
          {scopedRuns.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No completed analysis runs match the current scope.
            </div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
              <thead className="bg-slate-50/70 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5">Video Asset</th>
                  <th className="px-3 py-2.5">Run Identifier</th>
                  <th className="px-3 py-2.5">Profile</th>
                  <th className="px-3 py-2.5">Speed Mode</th>
                  <th className="px-3 py-2.5">Vehicles</th>
                  <th className="px-3 py-2.5">Incidents</th>
                  <th className="px-3 py-2.5">Throughput</th>
                  <th className="px-3 py-2.5">Started At</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scopedRuns.slice(0, 10).map((r) => {
                  const vid = videos.find(v => v.id === r.video_id)
                  const name = vid ? videoDisplayName(vid, fallbackNumbers) : 'Unknown'
                  const meta = getRunMetadata(r)
                  const isRunScope = selectedScope === `run:${r.id}`

                  return (
                    <tr key={r.id} className={cn("hover:bg-slate-50/60 transition-colors", isRunScope && "bg-indigo-50/40")}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Film className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-semibold text-slate-900 truncate max-w-[150px]">{name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-slate-500 text-[11px]">
                        #{r.id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-3 font-medium text-slate-700">
                        {meta.profile}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {meta.speed}
                      </td>
                      <td className="px-3 py-3 font-mono font-semibold text-slate-800">
                        {meta.uniqueVehicles !== null ? `${meta.uniqueVehicles} vehicles` : '—'}
                      </td>
                      <td className="px-3 py-3 font-mono">
                        {(r.incidents_created || 0) > 0 ? (
                          <span className="text-rose-600 font-semibold">{r.incidents_created}</span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-500 font-mono text-[11px]">
                        {r.fps ? `${Math.round(r.fps)} FPS` : '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-400 text-[11px]">
                        {r.started_at ? format(new Date(r.started_at), 'MMM d, HH:mm') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right space-x-1.5">
                        <button
                          onClick={() => setSelectedScope(isRunScope ? 'all' : `run:${r.id}`)}
                          className={cn(
                            "px-2 py-1 rounded text-xs font-medium border transition-colors cursor-pointer",
                            isRunScope
                              ? "bg-indigo-600 text-white border-indigo-600"
                              : "bg-white text-slate-700 hover:bg-slate-50 border-slate-200 shadow-2xs"
                          )}
                          title="Filter entire analytics view to this run"
                        >
                          {isRunScope ? 'Active Run' : 'Filter to Run'}
                        </button>
                        {r.video_id && (
                          <button
                            onClick={() => navigate(`/app/videos?video=${encodeURIComponent(r.video_id!)}`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-indigo-700 border border-indigo-200 rounded text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
                            title="Open original video review"
                          >
                            <Eye className="w-3.5 h-3.5" /> Review
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
    </div>
  )
}
