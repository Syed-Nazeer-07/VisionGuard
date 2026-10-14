import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { 
  TrendingUp, TrendingDown, Target, Clock, ShieldAlert,
  AlertOctagon, AlertTriangle, Lightbulb, LineChart, Loader2,
  CheckCircle2, XCircle, FolderOpen, FolderSearch, FileText, BarChart3,
  Film, RefreshCw, RotateCcw, ArrowUpRight, ChevronRight, Play,
  Car, Truck, Bus, Bike, Users, Activity, Cpu, Layers, Shield,
  ExternalLink, Info, Check, Filter, Calendar
} from 'lucide-react'
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, 
  ResponsiveContainer, BarChart, Bar, Cell
} from 'recharts'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import type { VideoAsset, AnalysisRun } from '../services/db'
import { fallbackVideoNumbers, videoDisplayName } from '../lib/videoAssets'
import { 
  subDays, startOfDay, differenceInHours, differenceInMinutes, 
  format as formatDate, formatDistanceToNow 
} from 'date-fns'

// ============================================================================
// Types
// ============================================================================

export interface ExecutiveIncident {
  id: string
  incident_type: string
  violation_type?: string | null
  severity: string | null
  status: string | null
  description: string | null
  created_at: string
  resolved_at?: string | null
  video_id: string | null
  camera_id: string | null
  analysis_run_id: string | null
  track_id: number | null
  confidence: number | null
  assigned_to?: string | null
  metadata: Record<string, any> | null
  cameras?: { name: string } | null
  video?: VideoAsset | null
}

export interface ExecutiveCase {
  id: string
  incident_id: string | null
  status: string
  assigned_to: string | null
  created_at: string
  updated_at: string
  title?: string
  priority?: string
  assigneeName?: string
  assigneeEmail?: string
}

export interface ExecutiveTrack {
  id: string
  video_id: string | null
  track_id: number
  object_type: string
  confidence: number
  frame_count: number | null
  analysis_run_id: string | null
  created_at?: string
}

export interface ExecutiveProfile {
  id: string
  name: string | null
  email: string | null
  role?: string
}

type PeriodRange = 'today' | '7d' | '30d' | 'all'
type SeverityScope = 'all' | 'critical' | 'high' | 'medium' | 'low'

const LOCAL_STORAGE_CASE_META = 'visionguard_cases_metadata'

function getCaseMetadataCache(): Record<string, { title?: string; priority?: string; description?: string; additional_incident_ids?: string[] }> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_CASE_META)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

// Calculate delta between current and previous periods
function computePeriodDelta(current: number, previous: number | null, isHigherBetter = false): {
  text: string
  positive: boolean | null
  isFavorable: boolean
} | null {
  if (previous === null) return null
  if (previous === 0) {
    if (current === 0) return { text: '0%', positive: null, isFavorable: true }
    return { text: `+${current} new`, positive: true, isFavorable: isHigherBetter }
  }
  const pct = Math.round(((current - previous) / previous) * 100)
  const sign = pct > 0 ? '+' : ''
  const isPositive = pct > 0
  const isFavorable = isHigherBetter ? pct >= 0 : pct <= 0

  return {
    text: `${sign}${pct}%`,
    positive: isPositive,
    isFavorable
  }
}

// ============================================================================
// Component
// ============================================================================

export function ExecutiveIntelligence() {
  const navigate = useNavigate()
  const { user, role } = useAuthStore()

  // Data Loading States
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Persisted Datasets
  const [videos, setVideos] = useState<VideoAsset[]>([])
  const [runs, setRuns] = useState<AnalysisRun[]>([])
  const [trackedObjects, setTrackedObjects] = useState<ExecutiveTrack[]>([])
  const [incidents, setIncidents] = useState<ExecutiveIncident[]>([])
  const [cases, setCases] = useState<ExecutiveCase[]>([])
  const [profiles, setProfiles] = useState<ExecutiveProfile[]>([])
  const [auditLogsCount, setAuditLogsCount] = useState<number>(0)

  // Functional Filters
  const [period, setPeriod] = useState<PeriodRange>('7d')
  const [selectedVideoId, setSelectedVideoId] = useState<string>('all')
  const [severityFilter, setSeverityFilter] = useState<SeverityScope>('all')

  // --------------------------------------------------------------------------
  // Data Fetching
  // --------------------------------------------------------------------------
  const fetchExecutiveData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true)
    else setRefreshing(true)
    setError(null)

    try {
      const [vidRes, runsRes, tracksRes, incRes, casesRes, profRes, auditRes] = await Promise.all([
        supabase.from('video_assets').select('*').order('uploaded_at', { ascending: false }),
        supabase.from('analysis_runs').select('*').order('started_at', { ascending: false }),
        supabase.from('tracked_objects').select('id, video_id, track_id, object_type, confidence, frame_count, analysis_run_id, created_at'),
        supabase.from('incidents').select('*, cameras(name)').order('created_at', { ascending: false }),
        supabase.from('cases').select('*').order('created_at', { ascending: false }),
        supabase.from('profiles').select('id, name, email, role'),
        supabase.from('audit_logs').select('id', { count: 'exact', head: true })
      ])

      if (vidRes.error) console.warn('video_assets fetch warning:', vidRes.error)
      if (runsRes.error) console.warn('analysis_runs fetch warning:', runsRes.error)
      if (tracksRes.error) console.warn('tracked_objects fetch warning:', tracksRes.error)
      if (incRes.error) console.warn('incidents fetch warning:', incRes.error)
      if (casesRes.error) console.warn('cases fetch warning:', casesRes.error)
      if (profRes.error) console.warn('profiles fetch warning:', profRes.error)

      const fetchedVideos = (vidRes.data || []) as VideoAsset[]
      const fetchedRuns = (runsRes.data || []) as AnalysisRun[]
      const fetchedTracks = (tracksRes.data || []) as ExecutiveTrack[]
      const fetchedProfiles = (profRes.data || []) as ExecutiveProfile[]
      const profileMap = new Map<string, ExecutiveProfile>()
      fetchedProfiles.forEach(p => profileMap.set(p.id, p))

      // Video Lookup Map
      const videoMap = new Map<string, VideoAsset>()
      fetchedVideos.forEach(v => videoMap.set(v.id, v))

      // Hydrate Incidents
      const hydratedIncidents: ExecutiveIncident[] = ((incRes.data || []) as any[]).map(inc => ({
        ...inc,
        video: inc.video_id ? videoMap.get(inc.video_id) || null : null
      }))

      // Hydrate Cases with profile data & cache
      const cachedMeta = getCaseMetadataCache()
      const hydratedCases: ExecutiveCase[] = ((casesRes.data || []) as any[]).map(c => {
        const meta = cachedMeta[c.id] || {}
        const assignee = c.assigned_to ? profileMap.get(c.assigned_to) : null
        return {
          ...c,
          title: meta.title || `Investigation #${c.id.slice(0, 8)}`,
          priority: meta.priority || 'Medium',
          assigneeName: assignee?.name || null,
          assigneeEmail: assignee?.email || null
        }
      })

      setVideos(fetchedVideos)
      setRuns(fetchedRuns)
      setTrackedObjects(fetchedTracks)
      setIncidents(hydratedIncidents)
      setCases(hydratedCases)
      setProfiles(fetchedProfiles)
      if (auditRes.count !== null && auditRes.count !== undefined) {
        setAuditLogsCount(auditRes.count)
      }
    } catch (err: any) {
      console.error('Failed to load executive data:', err)
      setError(err.message || String(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchExecutiveData()
  }, [fetchExecutiveData])

  const fallbackNumbers = useMemo(() => fallbackVideoNumbers(videos), [videos])

  // Latest completed analysis run per video (avoids double counting re-runs of the same footage)
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

  // --------------------------------------------------------------------------
  // Scope and Date-Range Windows
  // --------------------------------------------------------------------------
  const dateWindows = useMemo(() => {
    const now = new Date()
    if (period === 'today') {
      const currentStart = startOfDay(now)
      const previousStart = startOfDay(subDays(now, 1))
      const previousEnd = currentStart
      return { currentStart, previousStart, previousEnd, label: 'Today' }
    }
    if (period === '7d') {
      const currentStart = subDays(now, 7)
      const previousStart = subDays(now, 14)
      const previousEnd = currentStart
      return { currentStart, previousStart, previousEnd, label: 'Last 7 Days' }
    }
    if (period === '30d') {
      const currentStart = subDays(now, 30)
      const previousStart = subDays(now, 60)
      const previousEnd = currentStart
      return { currentStart, previousStart, previousEnd, label: 'Last 30 Days' }
    }
    return { currentStart: null, previousStart: null, previousEnd: null, label: 'All-Time' }
  }, [period])

  // Filtered Datasets for Current Period
  const currentIncidents = useMemo(() => {
    return incidents.filter(inc => {
      if (selectedVideoId !== 'all' && inc.video_id !== selectedVideoId) return false
      if (severityFilter !== 'all' && (inc.severity || 'Medium').toLowerCase() !== severityFilter) return false
      if (dateWindows.currentStart && new Date(inc.created_at) < dateWindows.currentStart) return false
      return true
    })
  }, [incidents, selectedVideoId, severityFilter, dateWindows])

  const previousIncidents = useMemo(() => {
    if (!dateWindows.previousStart || !dateWindows.previousEnd) return []
    return incidents.filter(inc => {
      if (selectedVideoId !== 'all' && inc.video_id !== selectedVideoId) return false
      if (severityFilter !== 'all' && (inc.severity || 'Medium').toLowerCase() !== severityFilter) return false
      const t = new Date(inc.created_at)
      return t >= dateWindows.previousStart! && t < dateWindows.previousEnd!
    })
  }, [incidents, selectedVideoId, severityFilter, dateWindows])

  const currentCases = useMemo(() => {
    return cases.filter(c => {
      if (dateWindows.currentStart && new Date(c.created_at) < dateWindows.currentStart) return false
      return true
    })
  }, [cases, dateWindows])

  const previousCases = useMemo(() => {
    if (!dateWindows.previousStart || !dateWindows.previousEnd) return []
    return cases.filter(c => {
      const t = new Date(c.created_at)
      return t >= dateWindows.previousStart! && t < dateWindows.previousEnd!
    })
  }, [cases, dateWindows])

  // Videos within scope
  const scopedVideos = useMemo(() => {
    if (selectedVideoId === 'all') return videos
    return videos.filter(v => v.id === selectedVideoId)
  }, [videos, selectedVideoId])

  // Completed analysis runs within period & scope
  const scopedRuns = useMemo(() => {
    return runs.filter(r => {
      if (selectedVideoId !== 'all' && r.video_id !== selectedVideoId) return false
      if (dateWindows.currentStart && new Date(r.started_at) < dateWindows.currentStart) return false
      return true
    })
  }, [runs, selectedVideoId, dateWindows])

  // --------------------------------------------------------------------------
  // Executive Overview Metrics
  // --------------------------------------------------------------------------

  // 1. Traffic Volume: Unique tracked vehicles (deduplicated across runs)
  const uniqueVehiclesCount = useMemo(() => {
    const trackSet = new Set<string>()
    trackedObjects.forEach(t => {
      if (selectedVideoId !== 'all' && t.video_id !== selectedVideoId) return
      if (dateWindows.currentStart && t.created_at && new Date(t.created_at) < dateWindows.currentStart) return
      if (t.video_id && t.track_id !== null && t.track_id !== undefined) {
        trackSet.add(`${t.video_id}:${t.track_id}`)
      }
    })
    if (trackSet.size > 0) return trackSet.size

    // Fallback: sum unique_vehicles metadata from scoped videos
    return scopedVideos.reduce((acc, v) => {
      const meta = (v.metadata && typeof v.metadata === 'object' ? v.metadata : {}) as Record<string, any>
      return acc + Number(meta.unique_vehicles ?? meta.summary?.unique_vehicles ?? 0)
    }, 0)
  }, [trackedObjects, selectedVideoId, dateWindows, scopedVideos])

  // 2. Footage Analyzed: Total duration & frames
  const footageMetrics = useMemo(() => {
    let totalSeconds = 0
    let totalFrames = 0

    scopedVideos.forEach(v => {
      if (v.processing_status === 'completed' || latestRunPerVideo.has(v.id)) {
        totalSeconds += Number(v.duration_seconds || 0)
        const meta = (v.metadata && typeof v.metadata === 'object' ? v.metadata : {}) as Record<string, any>
        totalFrames += Number(meta.total_frames ?? meta.processed_frames ?? meta.summary?.total_frames ?? v.frame_count ?? 0)
      }
    })

    let durationLabel = '0.0s'
    if (totalSeconds > 0) {
      if (totalSeconds < 60) durationLabel = `${Math.round(totalSeconds)}s`
      else if (totalSeconds < 3600) durationLabel = `${(totalSeconds / 60).toFixed(1)} min`
      else durationLabel = `${(totalSeconds / 3600).toFixed(1)} hrs`
    }

    return { totalSeconds, totalFrames, durationLabel }
  }, [scopedVideos, latestRunPerVideo])

  // 3. Incident Exposure: Counts & Severity breakdown
  const incidentExposure = useMemo(() => {
    const total = currentIncidents.length
    let critical = 0
    let high = 0
    let medium = 0
    let low = 0

    currentIncidents.forEach(inc => {
      const s = (inc.severity || 'Medium').toLowerCase()
      if (s === 'critical') critical++
      else if (s === 'high') high++
      else if (s === 'medium') medium++
      else if (s === 'low') low++
    })

    const criticalOrHigh = critical + high
    const critHighPct = total > 0 ? Math.round((criticalOrHigh / total) * 100) : 0

    return { total, critical, high, medium, low, criticalOrHigh, critHighPct }
  }, [currentIncidents])

  // 4. Investigation Backlog: Unresolved incidents & open cases
  const backlogMetrics = useMemo(() => {
    const unresolvedIncidents = currentIncidents.filter(
      i => i.status !== 'Resolved' && i.status !== 'Rejected'
    )
    const openCases = currentCases.filter(
      c => c.status === 'New' || c.status === 'Investigating' || c.status === 'Escalated'
    )
    const escalatedCases = currentCases.filter(c => c.status === 'Escalated')

    return {
      unresolvedIncidentsCount: unresolvedIncidents.length,
      unresolvedIncidents,
      openCasesCount: openCases.length,
      openCases,
      escalatedCasesCount: escalatedCases.length
    }
  }, [currentIncidents, currentCases])

  // 5. Resolution Progress: Resolved & Rejected counts
  const resolutionMetrics = useMemo(() => {
    const resolvedIncidents = currentIncidents.filter(i => i.status === 'Resolved')
    const rejectedIncidents = currentIncidents.filter(i => i.status === 'Rejected')
    const closedCases = currentCases.filter(c => c.status === 'Approved' || c.status === 'Closed')

    const totalDecisions = resolvedIncidents.length + rejectedIncidents.length
    const totalIncidents = currentIncidents.length
    const resolutionRatePct = totalIncidents > 0
      ? Math.round((totalDecisions / totalIncidents) * 100)
      : 0

    // Average Resolution Time (hours) using real timestamps
    let totalHours = 0
    let validDurationCount = 0

    resolvedIncidents.forEach(i => {
      if (i.resolved_at && i.created_at) {
        const hrs = differenceInHours(new Date(i.resolved_at), new Date(i.created_at))
        if (hrs >= 0) {
          totalHours += hrs
          validDurationCount++
        }
      }
    })

    let avgResolutionStr = 'N/A'
    if (validDurationCount > 0) {
      const avg = totalHours / validDurationCount
      avgResolutionStr = avg < 1 ? '< 1 hr' : `${avg.toFixed(1)} hrs`
    }

    return {
      resolvedCount: resolvedIncidents.length,
      rejectedCount: rejectedIncidents.length,
      closedCasesCount: closedCases.length,
      resolutionRatePct,
      avgResolutionStr,
      validDurationCount
    }
  }, [currentIncidents, currentCases])

  // 6. Analysis Runs Execution
  const pipelineMetrics = useMemo(() => {
    const completed = scopedRuns.filter(r => r.status === 'completed').length
    const failed = scopedRuns.filter(r => r.status === 'failed').length
    const total = completed + failed
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 100

    let balancedCount = 0
    let highRecallCount = 0
    let fullCount = 0
    let fastCount = 0

    scopedRuns.forEach(r => {
      const m = (r.metrics && typeof r.metrics === 'object' ? r.metrics : {}) as Record<string, any>
      if (m.detection_profile === 'high_recall') highRecallCount++
      else balancedCount++

      if (m.processing_speed === 'fast') fastCount++
      else fullCount++
    })

    return {
      completed,
      failed,
      total,
      successRate,
      balancedCount,
      highRecallCount,
      fullCount,
      fastCount
    }
  }, [scopedRuns])

  // Period-over-period comparative deltas
  const incidentDelta = useMemo(() => {
    return computePeriodDelta(
      currentIncidents.length, 
      dateWindows.previousStart ? previousIncidents.length : null, 
      false
    )
  }, [currentIncidents, previousIncidents, dateWindows])

  const openCasesDelta = useMemo(() => {
    const prevOpen = previousCases.filter(
      c => c.status === 'New' || c.status === 'Investigating' || c.status === 'Escalated'
    ).length
    return computePeriodDelta(
      backlogMetrics.openCasesCount,
      dateWindows.previousStart ? prevOpen : null,
      false
    )
  }, [backlogMetrics.openCasesCount, previousCases, dateWindows])

  // --------------------------------------------------------------------------
  // Data-Driven Rule-Based Executive Summary
  // --------------------------------------------------------------------------
  const executiveSummary = useMemo(() => {
    if (currentIncidents.length === 0 && uniqueVehiclesCount === 0 && pipelineMetrics.completed === 0) {
      return {
        status: 'empty',
        text: `No traffic footage, vehicle tracking, or incidents recorded for the ${dateWindows.label} period. Switch to 'All-Time' or run analysis on new footage in the Live Analysis workspace.`
      }
    }

    const sentences: string[] = []

    // 1. Throughput & Volume
    sentences.push(
      `During ${dateWindows.label}, VisionGuard processed ${footageMetrics.durationLabel} of footage across ${pipelineMetrics.completed} analysis run${pipelineMetrics.completed === 1 ? '' : 's'}, tracking ${uniqueVehiclesCount.toLocaleString()} unique vehicles.`
    )

    // 2. Incident & Risk Exposure
    if (incidentExposure.total > 0) {
      sentences.push(
        `${incidentExposure.total} traffic safety infractions were recorded, with ${incidentExposure.criticalOrHigh} (${incidentExposure.critHighPct}%) classified as Critical or High severity.`
      )
    } else {
      sentences.push('Zero safety infractions were recorded in this scope.')
    }

    // 3. Operational Backlog
    if (backlogMetrics.unresolvedIncidentsCount > 0 || backlogMetrics.openCasesCount > 0) {
      sentences.push(
        `Active operational backlog comprises ${backlogMetrics.unresolvedIncidentsCount} unverified incident${backlogMetrics.unresolvedIncidentsCount === 1 ? '' : 's'} in the Review Queue and ${backlogMetrics.openCasesCount} active case${backlogMetrics.openCasesCount === 1 ? '' : 's'} under investigation.`
      )
    } else {
      sentences.push('The operational review backlog is clear with zero pending events.')
    }

    // 4. Resolution Throughput
    if (resolutionMetrics.avgResolutionStr !== 'N/A') {
      sentences.push(
        `Mean verified incident turnaround time is ${resolutionMetrics.avgResolutionStr} across ${resolutionMetrics.validDurationCount} closed item${resolutionMetrics.validDurationCount === 1 ? '' : 's'}.`
      )
    }

    return {
      status: 'ok',
      text: sentences.join(' ')
    }
  }, [
    currentIncidents, uniqueVehiclesCount, pipelineMetrics, 
    dateWindows, footageMetrics, incidentExposure, 
    backlogMetrics, resolutionMetrics
  ])

  // --------------------------------------------------------------------------
  // Trend Visualization Data
  // --------------------------------------------------------------------------
  const trendChartData = useMemo(() => {
    const data: { label: string; incidents: number; cases: number; critical: number }[] = []
    const now = new Date()

    if (period === 'today') {
      // 6 4-hour intervals
      for (let h = 0; h < 24; h += 4) {
        const start = startOfDay(now)
        start.setHours(h, 0, 0, 0)
        const end = startOfDay(now)
        end.setHours(h + 3, 59, 59, 999)

        const incs = currentIncidents.filter(i => {
          const t = new Date(i.created_at)
          return t >= start && t <= end
        })
        const cs = currentCases.filter(c => {
          const t = new Date(c.created_at)
          return t >= start && t <= end
        })
        const crit = incs.filter(i => (i.severity || '').toLowerCase() === 'critical')

        data.push({
          label: `${String(h).padStart(2, '0')}:00`,
          incidents: incs.length,
          cases: cs.length,
          critical: crit.length
        })
      }
    } else {
      const daysCount = period === '7d' ? 7 : period === '30d' ? 30 : 14
      const step = period === '30d' ? 2 : 1

      for (let d = daysCount - 1; d >= 0; d -= step) {
        const date = subDays(now, d)
        const start = startOfDay(date)
        const end = new Date(start)
        end.setDate(end.getDate() + (step - 1))
        end.setHours(23, 59, 59, 999)

        const incs = currentIncidents.filter(i => {
          const t = new Date(i.created_at)
          return t >= start && t <= end
        })
        const cs = currentCases.filter(c => {
          const t = new Date(c.created_at)
          return t >= start && t <= end
        })
        const crit = incs.filter(i => (i.severity || '').toLowerCase() === 'critical')

        data.push({
          label: formatDate(date, period === '7d' ? 'EEE' : 'MMM d'),
          incidents: incs.length,
          cases: cs.length,
          critical: crit.length
        })
      }
    }

    return data
  }, [period, currentIncidents, currentCases])

  // --------------------------------------------------------------------------
  // Traffic Composition Data
  // --------------------------------------------------------------------------
  const vehicleComposition = useMemo(() => {
    let car = 0
    let truck = 0
    let bus = 0
    let motorcycle = 0

    trackedObjects.forEach(t => {
      if (selectedVideoId !== 'all' && t.video_id !== selectedVideoId) return
      if (dateWindows.currentStart && t.created_at && new Date(t.created_at) < dateWindows.currentStart) return

      const type = (t.object_type || '').toLowerCase()
      if (type === 'car') car++
      else if (type === 'truck') truck++
      else if (type === 'bus') bus++
      else if (type === 'motorcycle' || type === 'bike') motorcycle++
    })

    const total = car + truck + bus + motorcycle
    return [
      { name: 'Cars', count: car, pct: total > 0 ? Math.round((car / total) * 100) : 0, color: '#3b82f6', icon: Car },
      { name: 'Trucks', count: truck, pct: total > 0 ? Math.round((truck / total) * 100) : 0, color: '#f59e0b', icon: Truck },
      { name: 'Buses', count: bus, pct: total > 0 ? Math.round((bus / total) * 100) : 0, color: '#8b5cf6', icon: Bus },
      { name: 'Motorcycles', count: motorcycle, pct: total > 0 ? Math.round((motorcycle / total) * 100) : 0, color: '#10b981', icon: Bike }
    ]
  }, [trackedObjects, selectedVideoId, dateWindows])

  // --------------------------------------------------------------------------
  // Management Priority Items
  // --------------------------------------------------------------------------
  const managementPriorityIncidents = useMemo(() => {
    return currentIncidents
      .filter(i => {
        const isUnresolved = i.status !== 'Resolved' && i.status !== 'Rejected'
        const isCritHigh = i.severity === 'Critical' || i.severity === 'High'
        return isUnresolved && isCritHigh
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) // Oldest first
      .slice(0, 4)
  }, [currentIncidents])

  const managementPriorityCases = useMemo(() => {
    return currentCases
      .filter(c => c.status === 'Escalated' || c.status === 'Investigating' || c.status === 'New')
      .sort((a, b) => {
        if (a.status === 'Escalated' && b.status !== 'Escalated') return -1
        if (b.status === 'Escalated' && a.status !== 'Escalated') return 1
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })
      .slice(0, 4)
  }, [currentCases])

  // --------------------------------------------------------------------------
  // Investigator Assignment Workload
  // --------------------------------------------------------------------------
  const investigatorWorkload = useMemo(() => {
    const workloadMap = new Map<string, { profile: ExecutiveProfile; casesCount: number; resolvedCount: number }>()

    profiles.forEach(p => {
      workloadMap.set(p.id, { profile: p, casesCount: 0, resolvedCount: 0 })
    })

    cases.forEach(c => {
      if (c.assigned_to && workloadMap.has(c.assigned_to)) {
        workloadMap.get(c.assigned_to)!.casesCount++
      }
    })

    incidents.forEach(i => {
      if (i.assigned_to && i.status === 'Resolved' && workloadMap.has(i.assigned_to)) {
        workloadMap.get(i.assigned_to)!.resolvedCount++
      }
    })

    return Array.from(workloadMap.values())
      .filter(w => w.casesCount > 0 || w.resolvedCount > 0)
      .slice(0, 5)
  }, [profiles, cases, incidents])

  // Active filter count
  const activeFiltersCount = useMemo(() => {
    let count = 0
    if (period !== '7d') count++
    if (selectedVideoId !== 'all') count++
    if (severityFilter !== 'all') count++
    return count
  }, [period, selectedVideoId, severityFilter])

  const handleResetFilters = () => {
    setPeriod('7d')
    setSelectedVideoId('all')
    setSeverityFilter('all')
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex flex-col items-center justify-center min-h-[440px] max-w-[1700px] mx-auto">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
        <h3 className="text-sm font-bold text-slate-800">Synthesizing Executive Intelligence</h3>
        <p className="text-xs text-slate-500 mt-1">Aggregating cross-system metrics from traffic tracks, incidents, and cases...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[1700px] mx-auto pb-12">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Executive Intelligence</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
              Management Overview
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Understand traffic activity, incident exposure, operational performance, and investigation progress.
          </p>
        </div>

        {/* Global Toolbar Actions */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => fetchExecutiveData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin text-blue-600")} />
            <span>{refreshing ? 'Updating...' : 'Refresh'}</span>
          </button>

          {/* Quick Navigation into Specialized Workflows */}
          <Link
            to="/app/review-queue"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <span>Review Queue</span>
            {backlogMetrics.unresolvedIncidentsCount > 0 && (
              <span className="px-1.5 py-0.2 bg-blue-600 text-white rounded text-[10px] font-bold">
                {backlogMetrics.unresolvedIncidentsCount}
              </span>
            )}
          </Link>

          <Link
            to="/app/cases"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <span>Case Management</span>
            {backlogMetrics.openCasesCount > 0 && (
              <span className="px-1.5 py-0.2 bg-slate-800 text-white rounded text-[10px] font-bold">
                {backlogMetrics.openCasesCount}
              </span>
            )}
          </Link>

          <Link
            to="/app/reports"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold shadow-2xs transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-slate-500" />
            <span>Reports</span>
          </Link>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {/* Period Selector */}
          <div className="flex items-center bg-slate-50 p-1 border border-slate-200 rounded-lg">
            {(['today', '7d', '30d', 'all'] as PeriodRange[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
                  period === p
                    ? "bg-white text-slate-900 shadow-2xs border border-slate-200/80"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-100/50"
                )}
              >
                {p === 'today' ? 'Today' : p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : 'All-Time'}
              </button>
            ))}
          </div>

          {/* Video Footage Scope */}
          <select
            value={selectedVideoId}
            onChange={e => setSelectedVideoId(e.target.value)}
            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none hover:border-slate-300 focus:border-blue-500 cursor-pointer shadow-2xs max-w-xs truncate"
          >
            <option value="all">All Analyzed Footage ({videos.length})</option>
            {videos.map(v => (
              <option key={v.id} value={v.id}>
                {videoDisplayName(v, fallbackNumbers)} ({v.filename})
              </option>
            ))}
          </select>

          {/* Severity Scope */}
          <select
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value as SeverityScope)}
            className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none hover:border-slate-300 focus:border-blue-500 cursor-pointer shadow-2xs"
          >
            <option value="all">All Incident Severities</option>
            <option value="critical">Critical Severity Only</option>
            <option value="high">High Severity Only</option>
            <option value="medium">Medium Severity Only</option>
            <option value="low">Low Severity Only</option>
          </select>
        </div>

        {/* Filter Controls Right */}
        <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
          {activeFiltersCount > 0 && (
            <>
              <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                {activeFiltersCount} active filter{activeFiltersCount > 1 ? 's' : ''}
              </span>
              <button
                onClick={handleResetFilters}
                className="flex items-center gap-1 px-2 py-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg font-medium transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Data-Driven Executive Summary Banner */}
      <div className={cn(
        "p-4 rounded-xl border transition-all shadow-2xs flex items-start gap-3.5",
        executiveSummary.status === 'ok'
          ? "bg-slate-900 text-white border-slate-800"
          : "bg-amber-50/80 text-amber-900 border-amber-200"
      )}>
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
          executiveSummary.status === 'ok' ? "bg-slate-800 text-blue-400" : "bg-amber-100 text-amber-700"
        )}>
          <Lightbulb className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h3 className={cn(
              "text-xs font-bold uppercase tracking-wider",
              executiveSummary.status === 'ok' ? "text-slate-300" : "text-amber-800"
            )}>
              Executive Operational Synthesis • {dateWindows.label}
            </h3>
            <span className={cn(
              "text-[10px] font-mono",
              executiveSummary.status === 'ok' ? "text-slate-400" : "text-amber-700"
            )}>
              Audited Records Derived
            </span>
          </div>
          <p className={cn(
            "text-xs mt-1 leading-relaxed",
            executiveSummary.status === 'ok' ? "text-slate-200" : "text-amber-900"
          )}>
            {executiveSummary.text}
          </p>
        </div>
      </div>

      {/* Overview Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. Traffic Volume */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Traffic Volume</span>
            <Car className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {uniqueVehiclesCount.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 truncate">
            Unique tracked vehicles
          </div>
        </div>

        {/* 2. Footage Analyzed */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Footage Analyzed</span>
            <Film className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {footageMetrics.durationLabel}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 truncate">
            {footageMetrics.totalFrames.toLocaleString()} frames processed
          </div>
        </div>

        {/* 3. Incident Exposure */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Incident Exposure</span>
            <AlertOctagon className="w-4 h-4 text-rose-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-bold text-rose-600">
              {incidentExposure.total}
            </div>
            {incidentDelta && (
              <span className={cn(
                "text-[10px] font-bold flex items-center",
                incidentDelta.isFavorable ? "text-emerald-600" : "text-rose-600"
              )}>
                {incidentDelta.positive ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                {incidentDelta.text}
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 truncate">
            {incidentExposure.criticalOrHigh} Critical/High ({incidentExposure.critHighPct}%)
          </div>
        </div>

        {/* 4. Investigation Backlog */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Active Backlog</span>
            <ShieldAlert className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-bold text-amber-600">
              {backlogMetrics.unresolvedIncidentsCount}
            </div>
            {openCasesDelta && (
              <span className={cn(
                "text-[10px] font-bold flex items-center",
                openCasesDelta.isFavorable ? "text-emerald-600" : "text-amber-600"
              )}>
                {openCasesDelta.text}
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 truncate">
            {backlogMetrics.openCasesCount} open investigation cases
          </div>
        </div>

        {/* 5. Resolution Throughput */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Resolution Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-700">
            {resolutionMetrics.resolutionRatePct}%
          </div>
          <div className="text-[10px] text-slate-500 mt-1 truncate">
            {resolutionMetrics.resolvedCount} verified • {resolutionMetrics.rejectedCount} rejected
          </div>
        </div>

        {/* 6. Mean Resolution Duration */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Avg Resolution</span>
            <Clock className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-bold text-purple-700">
            {resolutionMetrics.avgResolutionStr}
          </div>
          <div className="text-[10px] text-slate-500 mt-1 truncate">
            {resolutionMetrics.validDurationCount > 0
              ? `${resolutionMetrics.validDurationCount} resolved items measured`
              : 'Awaiting closed timestamps'}
          </div>
        </div>
      </div>

      {/* Main Intelligence Grid: Trend Velocity & Severity Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        
        {/* Trend Area Chart (Incident & Case Velocity) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-2xs p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Incident & Case Velocity Trend</h3>
              <p className="text-xs text-slate-500">
                Timeline distribution of safety infractions and investigative case creation over {dateWindows.label}.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-semibold">
              <div className="flex items-center gap-1.5 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Incidents
              </div>
              <div className="flex items-center gap-1.5 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-900"></span> Cases
              </div>
              <div className="flex items-center gap-1.5 text-rose-600">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span> Critical
              </div>
            </div>
          </div>

          <div className="h-[280px]">
            {trendChartData.length === 0 || trendChartData.every(d => d.incidents === 0 && d.cases === 0) ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <LineChart className="w-10 h-10 opacity-30 mb-2" />
                <p className="text-xs">No activity recorded for this date window</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="execColorIncidents" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="execColorCases" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0f172a" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#0f172a" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)', fontSize: '12px' }}
                  />
                  <Area type="monotone" dataKey="incidents" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#execColorIncidents)" name="Incidents" />
                  <Area type="monotone" dataKey="cases" stroke="#0f172a" strokeWidth={2} fillOpacity={1} fill="url(#execColorCases)" name="Cases" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Severity Risk Distribution & Pipeline Execution */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">Incident Severity Distribution</h3>
            <p className="text-xs text-slate-500 mb-4">Breakdown of safety infractions by recorded risk level.</p>

            <div className="space-y-3">
              {[
                { label: 'Critical Severity', count: incidentExposure.critical, color: 'bg-rose-500', barColor: 'bg-rose-100', text: 'text-rose-700' },
                { label: 'High Severity', count: incidentExposure.high, color: 'bg-amber-500', barColor: 'bg-amber-100', text: 'text-amber-700' },
                { label: 'Medium Severity', count: incidentExposure.medium, color: 'bg-blue-500', barColor: 'bg-blue-100', text: 'text-blue-700' },
                { label: 'Low Severity', count: incidentExposure.low, color: 'bg-slate-400', barColor: 'bg-slate-100', text: 'text-slate-700' }
              ].map(s => {
                const pct = incidentExposure.total > 0 ? Math.round((s.count / incidentExposure.total) * 100) : 0
                return (
                  <div key={s.label}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-1.5 font-medium text-slate-700">
                        <span className={cn("w-2 h-2 rounded-full", s.color)} />
                        <span>{s.label}</span>
                      </div>
                      <span className="font-semibold text-slate-900">
                        {s.count} ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full", s.color)} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Pipeline Quality Sub-card */}
          <div className="pt-4 mt-4 border-t border-slate-100">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700">Analysis Pipeline Reliability</span>
              <span className="font-mono text-emerald-600 font-bold">{pipelineMetrics.successRate}% Success</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {pipelineMetrics.completed} completed • {pipelineMetrics.failed} failed runs ({pipelineMetrics.fastCount} Fast / {pipelineMetrics.fullCount} Full)
            </div>
          </div>
        </div>

      </div>

      {/* Management Priority Section (Items Requiring Immediate Action) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        
        {/* Critical/High Unresolved Incidents */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <AlertOctagon className="w-4 h-4 text-rose-600" />
                <h3 className="text-sm font-bold text-slate-900">Priority Unresolved Incidents</h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Critical and High infractions awaiting human verification.</p>
            </div>
            <Link
              to="/app/review-queue"
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <span>Review Queue</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {managementPriorityIncidents.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-xs font-medium text-slate-700">No Critical or High Incidents Pending</p>
              <p className="text-[11px] text-slate-400 mt-0.5">All high-priority detections in this period have been reviewed.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {managementPriorityIncidents.map(inc => {
                const sev = (inc.severity || 'Medium').toLowerCase()
                return (
                  <div
                    key={inc.id}
                    className="p-3 bg-slate-50 hover:bg-slate-100/70 rounded-lg border border-slate-200 flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0",
                        sev === 'critical' ? "bg-rose-100 text-rose-800 border border-rose-200" :
                        "bg-amber-100 text-amber-800 border border-amber-200"
                      )}>
                        {inc.severity}
                      </span>
                      <div>
                        <div className="text-xs font-bold text-slate-800 font-mono">
                          #{inc.id.slice(0, 8)} • <span className="font-sans font-medium">{inc.incident_type.replace(/_/g, ' ')}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {inc.video ? videoDisplayName(inc.video, fallbackNumbers) : 'Live Analysis'} • {formatDistanceToNow(new Date(inc.created_at), { addSuffix: true })}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Link
                        to={`/app/review-queue?id=${inc.id}`}
                        className="px-2.5 py-1 bg-white hover:bg-blue-50 text-blue-600 border border-slate-200 rounded text-xs font-semibold shadow-2xs transition-colors"
                      >
                        Review
                      </Link>
                      <Link
                        to={`/app/incidents?id=${inc.id}`}
                        className="p-1 text-slate-400 hover:text-slate-700"
                        title="View in Incident Center"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Open & Escalated Investigation Cases */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <FolderSearch className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">Active Investigation Cases</h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Cases currently open, investigating, or escalated for supervisor review.</p>
            </div>
            <Link
              to="/app/cases"
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <span>All Cases</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {managementPriorityCases.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-xs font-medium text-slate-700">No Active Case Backlog</p>
              <p className="text-[11px] text-slate-400 mt-0.5">All investigative cases in this reporting period have been resolved.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {managementPriorityCases.map(c => {
                const isEscalated = c.status === 'Escalated'
                return (
                  <div
                    key={c.id}
                    className="p-3 bg-slate-50 hover:bg-slate-100/70 rounded-lg border border-slate-200 flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0",
                        isEscalated ? "bg-rose-100 text-rose-800 border border-rose-200" :
                        c.status === 'Investigating' ? "bg-blue-100 text-blue-800 border border-blue-200" :
                        "bg-slate-200 text-slate-800 border border-slate-300"
                      )}>
                        {c.status}
                      </span>
                      <div>
                        <div className="text-xs font-bold text-slate-800 font-mono">
                          #{c.id.slice(0, 8)} • <span className="font-sans font-medium">{c.title || 'Investigation Case'}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Assigned: {c.assigneeName || c.assigneeEmail || 'Unassigned'} • Created {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                        </div>
                      </div>
                    </div>

                    <Link
                      to={`/app/cases?id=${c.id}`}
                      className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded text-xs font-semibold shadow-2xs transition-colors shrink-0"
                    >
                      Open Case
                    </Link>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>

      {/* Traffic Composition & Operational Governance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        
        {/* Fleet Composition Breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Traffic Fleet Composition</h3>
          <p className="text-xs text-slate-500 mb-4">Class distribution of unique vehicles tracked by YOLO11n.</p>

          <div className="space-y-3">
            {vehicleComposition.map(v => (
              <div key={v.name} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2.5">
                  <v.icon className="w-4 h-4 text-slate-600" />
                  <span className="text-xs font-medium text-slate-800">{v.name}</span>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-900">{v.count.toLocaleString()}</span>
                  <span className="text-[10px] text-slate-500 ml-1.5">({v.pct}%)</span>
                </div>
              </div>
            ))}
          </div>

          {/* Speed Calibration Disclosure */}
          <div className="mt-4 p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-amber-900 text-[11px] leading-relaxed flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Speed Calibration Notice:</span>
              Vehicle speeds represent optical track displacement. Regulatory enforcement requires physical site survey and road-plane homography calibration.
            </div>
          </div>
        </div>

        {/* Investigator Workload */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Investigator Workload</h3>
          <p className="text-xs text-slate-500 mb-4">Assigned cases and verified incident resolutions by operator.</p>

          {investigatorWorkload.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <Users className="w-8 h-8 opacity-40 mx-auto mb-2" />
              <p className="text-xs">No active staff assignments in this window</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Assignments are recorded upon case creation or incident review.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {investigatorWorkload.map(item => (
                <div key={item.profile.id} className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-800">
                      {item.profile.name || item.profile.email || 'Authorized Operator'}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      Role: {item.profile.role || 'Staff'}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="font-semibold text-slate-700">{item.casesCount} cases assigned</div>
                    <div className="text-[10px] text-emerald-600 font-medium">{item.resolvedCount} verified resolutions</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Operational Audit & System Governance */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-5 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">Operational Governance</h3>
            <p className="text-xs text-slate-500 mb-4">Audited transactions and platform activity tracking.</p>

            <div className="space-y-2.5">
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-between">
                <span className="text-xs text-slate-600">Total Audit Log Entries</span>
                <span className="text-xs font-mono font-bold text-slate-900">{auditLogsCount.toLocaleString()} events</span>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-between">
                <span className="text-xs text-slate-600">Active Cameras / Feeds</span>
                <span className="text-xs font-mono font-bold text-slate-900">{scopedVideos.length} footage assets</span>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-between">
                <span className="text-xs text-slate-600">Current Operator Role</span>
                <span className="text-xs font-mono font-bold text-indigo-700">{role || 'Viewer'}</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">Need formal documentation?</span>
            <Link
              to="/app/reports"
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <span>Generate PDF Report</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

      </div>

    </div>
  )
}
export default ExecutiveIntelligence
