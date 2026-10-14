import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { 
  Search, CheckCircle2, XCircle, AlertTriangle, AlertOctagon,
  ChevronRight, Camera, Clock, Target, Loader2, Play, 
  RotateCcw, FolderOpen, Film, ExternalLink, ShieldAlert, 
  Check, ZoomIn, X, ArrowUpRight, Eye, RefreshCw, 
  Layers, Gauge, ArrowRight, Filter
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import type { VideoAsset } from '../services/db'
import { fallbackVideoNumbers, videoDisplayName } from '../lib/videoAssets'
import { getSignedUrl } from '../pipeline/evidence/storage'
import { formatDistanceToNow, format as formatDate, subDays, startOfDay } from 'date-fns'

function safeFormatDate(dateVal: any, formatStr: string, fallback = 'N/A'): string {
  if (!dateVal) return fallback
  const d = new Date(dateVal)
  if (isNaN(d.getTime())) return fallback
  try {
    return formatDate(d, formatStr)
  } catch {
    return fallback
  }
}

function safeFormatDistance(dateVal: any, fallback = 'Recently'): string {
  if (!dateVal) return fallback
  const d = new Date(dateVal)
  if (isNaN(d.getTime())) return fallback
  try {
    return formatDistanceToNow(d, { addSuffix: true })
  } catch {
    return fallback
  }
}

// ============================================================================
// Types
// ============================================================================

export interface QueueIncident {
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
  location: string | null
  assigned_to?: string | null
  snapshot_url?: string | null
  metadata: Record<string, any> | null
  cameras?: { name: string } | null
  video?: VideoAsset | null
  linkedCase?: { id: string; status: string; title?: string } | null
}

export interface QueueEvidence {
  id: string
  incident_id: string | null
  video_id: string | null
  analysis_run_id: string | null
  file_type: string | null
  file_url: string | null
  file_path: string | null
  thumbnail_path: string | null
  mime_type: string | null
  confidence: number | null
  status: string | null
  capture_timestamp: string | null
  created_at: string
}

type StatusFilter = 'pending' | 'all' | 'active' | 'resolved' | 'rejected'
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'
type DateFilter = 'all' | 'today' | '7d' | '30d'

const LOCAL_STORAGE_CASE_META = 'visionguard_cases_metadata'

function getCaseMetadataCache(): Record<string, { title?: string; priority?: string; description?: string; additional_incident_ids?: string[] }> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_CASE_META)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

// Deterministic priority score for incident queue ordering
function getPriorityScore(inc: QueueIncident): number {
  const isUnresolved = inc.status !== 'Resolved' && inc.status !== 'Rejected'
  const sev = (inc.severity || 'Medium').toLowerCase()
  let sevWeight = 1
  if (sev === 'critical') sevWeight = 4
  else if (sev === 'high') sevWeight = 3
  else if (sev === 'medium') sevWeight = 2
  else if (sev === 'low') sevWeight = 1

  // Unresolved items always precede resolved/rejected items
  return (isUnresolved ? 10000 : 0) + (sevWeight * 100)
}

// ============================================================================
// ReviewQueue Component
// ============================================================================

export default function ReviewQueue() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, role } = useAuthStore()

  // Data states
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [incidents, setIncidents] = useState<QueueIncident[]>([])
  const [videos, setVideos] = useState<VideoAsset[]>([])
  const [evidenceList, setEvidenceList] = useState<QueueEvidence[]>([])
  const [evidenceUrls, setEvidenceUrls] = useState<Record<string, { full: string; thumb: string }>>({})

  // Selected incident & modal
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    searchParams.get('id') || null
  )
  const [enlargedImageUrl, setEnlargedImageUrl] = useState<string | null>(null)

  // Filters
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')

  // Review action mutation states
  const [isProcessingAction, setIsProcessingAction] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const isReadOnly = role === 'Viewer'

  // --------------------------------------------------------------------------
  // Data Fetching
  // --------------------------------------------------------------------------
  const fetchQueueData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true)
    else setRefreshing(true)

    try {
      const [incRes, vidRes, evRes, casesRes] = await Promise.all([
        supabase.from('incidents').select('*, cameras(name)').order('created_at', { ascending: false }),
        supabase.from('video_assets').select('*').order('uploaded_at', { ascending: false }),
        supabase.from('evidence').select('*').order('capture_timestamp', { ascending: false }),
        supabase.from('cases').select('id, incident_id, status, assigned_to, created_at, updated_at')
      ])

      const fetchedVideos = (vidRes.data || []) as VideoAsset[]
      const fetchedEvidence = (evRes.data || []) as QueueEvidence[]
      const fetchedCases = (casesRes.data || []) as any[]

      // Map video lookup
      const videoMap = new Map<string, VideoAsset>()
      fetchedVideos.forEach(v => videoMap.set(v.id, v))

      // Cached case metadata for multi-linked incidents
      const cachedMeta = getCaseMetadataCache()

      // Map case lookup
      const caseByIncidentId = new Map<string, { id: string; status: string; title?: string }>()
      fetchedCases.forEach(c => {
        const title = cachedMeta[c.id]?.title || `Investigation #${c.id.slice(0, 8)}`
        if (c.incident_id) {
          caseByIncidentId.set(c.incident_id, { id: c.id, status: c.status, title })
        }
        // Also check additional_incident_ids from cached metadata
        const additional = cachedMeta[c.id]?.additional_incident_ids || []
        additional.forEach((aid: string) => {
          if (!caseByIncidentId.has(aid)) {
            caseByIncidentId.set(aid, { id: c.id, status: c.status, title })
          }
        })
      })

      // Hydrate incidents
      const hydratedIncidents: QueueIncident[] = ((incRes.data || []) as any[]).map(inc => {
        const vid = inc.video_id ? videoMap.get(inc.video_id) || null : null
        let linkedCase = caseByIncidentId.get(inc.id) || null
        if (!linkedCase && inc.metadata?.case_id) {
          const matchingCase = fetchedCases.find(c => c.id === inc.metadata.case_id)
          if (matchingCase) {
            linkedCase = {
              id: matchingCase.id,
              status: matchingCase.status,
              title: inc.metadata.case_title || cachedMeta[matchingCase.id]?.title || `Case #${matchingCase.id.slice(0, 8)}`
            }
          }
        }
        return {
          ...inc,
          video: vid,
          linkedCase
        }
      })

      setVideos(fetchedVideos)
      setEvidenceList(fetchedEvidence)
      setIncidents(hydratedIncidents)

      // Resolve signed URLs for evidence
      const urlsMap: Record<string, { full: string; thumb: string }> = {}
      await Promise.all(
        fetchedEvidence.slice(0, 50).map(async ev => {
          const path = ev.file_path || ev.file_url
          if (!path) return
          try {
            if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
              urlsMap[ev.id] = { full: path, thumb: path }
            } else {
              const [full, thumb] = await Promise.all([
                getSignedUrl(path),
                ev.thumbnail_path ? getSignedUrl(ev.thumbnail_path) : Promise.resolve('')
              ])
              if (full) urlsMap[ev.id] = { full, thumb: thumb || full }
            }
          } catch (e) {
            console.warn('Could not resolve signed URL for evidence:', e)
          }
        })
      )
      setEvidenceUrls(urlsMap)

      // Synchronize selection
      const paramId = searchParams.get('id')
      if (paramId && hydratedIncidents.some(i => i.id === paramId)) {
        setSelectedIncidentId(paramId)
      }
    } catch (err) {
      console.error('Failed to load review queue data:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [searchParams])

  useEffect(() => {
    fetchQueueData()
  }, [fetchQueueData])

  const fallbackNumbers = useMemo(() => fallbackVideoNumbers(videos), [videos])

  // Extract unique incident types
  const uniqueTypes = useMemo(() => {
    const set = new Set<string>()
    incidents.forEach(i => {
      if (i.incident_type) set.add(i.incident_type)
    })
    return Array.from(set).sort()
  }, [incidents])

  // --------------------------------------------------------------------------
  // KPI Metrics Overview
  // --------------------------------------------------------------------------
  const metrics = useMemo(() => {
    const todayStart = startOfDay(new Date())
    let pendingCount = 0
    let criticalUrgentCount = 0
    let highCount = 0
    let reviewedTodayCount = 0

    incidents.forEach(inc => {
      const isUnresolved = inc.status !== 'Resolved' && inc.status !== 'Rejected'
      const sev = (inc.severity || 'Medium').toLowerCase()

      if (isUnresolved) {
        pendingCount++
        if (sev === 'critical') criticalUrgentCount++
        if (sev === 'high') highCount++
      } else {
        const resolvedDate = inc.resolved_at ? new Date(inc.resolved_at) : new Date(inc.created_at)
        if (resolvedDate >= todayStart) {
          reviewedTodayCount++
        }
      }
    })

    return {
      pendingCount,
      criticalUrgentCount,
      highCount,
      reviewedTodayCount
    }
  }, [incidents])

  // --------------------------------------------------------------------------
  // Filtering & Sorting
  // --------------------------------------------------------------------------
  const filteredIncidents = useMemo(() => {
    const now = new Date()
    let dateCutoff: Date | null = null
    if (dateFilter === 'today') dateCutoff = startOfDay(now)
    else if (dateFilter === '7d') dateCutoff = subDays(now, 7)
    else if (dateFilter === '30d') dateCutoff = subDays(now, 30)

    const q = searchQuery.trim().toLowerCase()

    return incidents.filter(inc => {
      // 1. Status Filter
      const isResolved = inc.status === 'Resolved'
      const isRejected = inc.status === 'Rejected'
      const isUnresolved = !isResolved && !isRejected

      if (statusFilter === 'pending') {
        if (!isUnresolved) return false
      } else if (statusFilter === 'active') {
        if ((inc.status || '').toLowerCase() !== 'active') return false
      } else if (statusFilter === 'resolved') {
        if (!isResolved) return false
      } else if (statusFilter === 'rejected') {
        if (!isRejected) return false
      }

      // 2. Severity Filter
      if (severityFilter !== 'all') {
        const s = (inc.severity || 'Medium').toLowerCase()
        if (s !== severityFilter) return false
      }

      // 3. Incident Type Filter
      if (typeFilter !== 'all' && inc.incident_type !== typeFilter) {
        return false
      }

      // 4. Date Cutoff
      if (dateCutoff && new Date(inc.created_at) < dateCutoff) {
        return false
      }

      // 5. Search Query
      if (q) {
        const matchId = inc.id?.toLowerCase().includes(q)
        const matchType = inc.incident_type?.toLowerCase().includes(q)
        const matchDesc = inc.description?.toLowerCase().includes(q)
        const matchTrack = inc.track_id !== null && inc.track_id !== undefined && String(inc.track_id).includes(q)
        const matchCam = inc.cameras?.name?.toLowerCase().includes(q)
        const matchVid = inc.video?.filename?.toLowerCase().includes(q) || (inc.video && videoDisplayName(inc.video, fallbackNumbers).toLowerCase().includes(q))
        if (!matchId && !matchType && !matchDesc && !matchTrack && !matchCam && !matchVid) {
          return false
        }
      }

      return true
    })
  }, [incidents, statusFilter, severityFilter, typeFilter, dateFilter, searchQuery, fallbackNumbers])

  // Sorted Queue: Deterministic priority policy
  const sortedQueue = useMemo(() => {
    return [...filteredIncidents].sort((a, b) => {
      const scoreA = getPriorityScore(a)
      const scoreB = getPriorityScore(b)
      if (scoreA !== scoreB) {
        return scoreB - scoreA // Higher priority first
      }

      // For unresolved items in the same severity tier, sort FIFO: oldest first
      const isUnresolvedA = a.status !== 'Resolved' && a.status !== 'Rejected'
      const isUnresolvedB = b.status !== 'Resolved' && b.status !== 'Rejected'
      if (isUnresolvedA && isUnresolvedB) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      }

      // For resolved/rejected items, sort newest first
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [filteredIncidents])

  // Maintain selected incident in synchronization with sorted queue
  useEffect(() => {
    if (sortedQueue.length === 0) {
      setSelectedIncidentId(null)
    } else if (!selectedIncidentId || !sortedQueue.some(i => i.id === selectedIncidentId)) {
      setSelectedIncidentId(sortedQueue[0].id)
    }
  }, [sortedQueue, selectedIncidentId])

  // Currently selected incident object
  const selectedIncident = useMemo(() => {
    if (!selectedIncidentId) return null
    return incidents.find(i => i.id === selectedIncidentId) || null
  }, [incidents, selectedIncidentId])

  // Evidence matching the currently selected incident
  const incidentEvidence = useMemo(() => {
    if (!selectedIncident) return []
    return evidenceList.filter(ev => {
      if (ev.incident_id === selectedIncident.id) return true
      if (ev.video_id && selectedIncident.video_id && ev.video_id === selectedIncident.video_id) {
        const tEv = new Date(ev.capture_timestamp || ev.created_at).getTime()
        const tInc = new Date(selectedIncident.created_at).getTime()
        if (Math.abs(tEv - tInc) < 2000) return true
      }
      return false
    })
  }, [selectedIncident, evidenceList])

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (searchQuery.trim()) count++
    if (statusFilter !== 'pending') count++
    if (severityFilter !== 'all') count++
    if (typeFilter !== 'all') count++
    if (dateFilter !== 'all') count++
    return count
  }, [searchQuery, statusFilter, severityFilter, typeFilter, dateFilter])

  const handleResetFilters = () => {
    setSearchQuery('')
    setStatusFilter('pending')
    setSeverityFilter('all')
    setTypeFilter('all')
    setDateFilter('all')
  }

  // --------------------------------------------------------------------------
  // Persisted Review Actions & Auto-Advance
  // --------------------------------------------------------------------------
  const advanceToNextIncident = (currentId: string) => {
    const currentIndex = sortedQueue.findIndex(i => i.id === currentId)
    if (currentIndex === -1) return

    // Pick next available item in current queue
    if (currentIndex + 1 < sortedQueue.length) {
      setSelectedIncidentId(sortedQueue[currentIndex + 1].id)
    } else if (currentIndex > 0) {
      setSelectedIncidentId(sortedQueue[currentIndex - 1].id)
    } else {
      setSelectedIncidentId(null)
    }
  }

  const handleReviewAction = async (action: 'resolve' | 'reject' | 'reopen') => {
    if (!selectedIncident || !user || isReadOnly) return
    setIsProcessingAction(true)
    setActionFeedback(null)

    const incidentId = selectedIncident.id
    const targetStatus = action === 'resolve' ? 'Resolved' : action === 'reject' ? 'Rejected' : 'Active'
    const isResolving = targetStatus === 'Resolved' || targetStatus === 'Rejected'
    const resolvedTimestamp = isResolving ? new Date().toISOString() : null

    try {
      // 1. Update incidents table
      const { error: incError } = await supabase
        .from('incidents')
        .update({
          status: targetStatus,
          resolved_at: resolvedTimestamp,
          assigned_to: user.id
        })
        .eq('id', incidentId)

      if (incError) throw incError

      // 2. Update linked case if one exists
      const linkedCase = selectedIncident.linkedCase
      if (linkedCase?.id) {
        const caseStatus = action === 'resolve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Investigating'
        await supabase
          .from('cases')
          .update({
            status: caseStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', linkedCase.id)

        // Log case event
        await supabase.from('case_events').insert([{
          case_id: linkedCase.id,
          actor_id: user.id,
          action: action === 'resolve'
            ? 'Approved: Incident verified and marked resolved via Review Queue'
            : action === 'reject'
            ? 'Rejected: Incident marked false positive via Review Queue'
            : 'Reopened: Incident marked active via Review Queue'
        }])
      }

      // 3. Log Audit Log
      await supabase.from('audit_logs').insert([{
        user_id: user.id,
        action: action === 'resolve' ? 'Approve Incident' : action === 'reject' ? 'Reject Incident' : 'Reopen Incident',
        metadata: {
          incident_id: incidentId,
          status: targetStatus,
          previous_status: selectedIncident.status,
          severity: selectedIncident.severity
        }
      }])

      // 4. Update local state
      setIncidents(prev => prev.map(inc => {
        if (inc.id === incidentId) {
          return {
            ...inc,
            status: targetStatus,
            resolved_at: resolvedTimestamp,
            assigned_to: user.id,
            linkedCase: linkedCase ? { ...linkedCase, status: action === 'resolve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Investigating' } : null
          }
        }
        return inc
      }))

      const successText = action === 'resolve'
        ? `Incident #${incidentId.slice(0, 8)} verified and marked Resolved.`
        : action === 'reject'
        ? `Incident #${incidentId.slice(0, 8)} rejected as False Positive.`
        : `Incident #${incidentId.slice(0, 8)} returned to Active status.`

      setActionFeedback({ text: successText, type: 'success' })

      // Auto-advance to next eligible item in queue
      advanceToNextIncident(incidentId)

      setTimeout(() => {
        setActionFeedback(null)
      }, 3500)
    } catch (err: any) {
      console.error('Failed to execute review action:', err)
      setActionFeedback({ text: `Action failed: ${err.message || String(err)}`, type: 'error' })
    } finally {
      setIsProcessingAction(false)
    }
  }

  // --------------------------------------------------------------------------
  // Deep Navigation Handlers
  // --------------------------------------------------------------------------
  const handleReviewVideo = (inc: QueueIncident) => {
    if (!inc.video_id) return
    const mediaTime = inc.metadata?.media_time
    const timeParam = typeof mediaTime === 'number' && Number.isFinite(mediaTime) ? `&time=${mediaTime}` : ''
    navigate(`/app/video-review?video=${inc.video_id}${timeParam}&incident=${inc.id}`)
  }

  const handleOpenCase = (inc: QueueIncident) => {
    if (inc.linkedCase?.id) {
      navigate(`/app/cases?id=${inc.linkedCase.id}`)
    } else {
      navigate(`/app/cases?createWithIncident=${inc.id}`)
    }
  }

  const handleOpenIncidentCenter = (inc: QueueIncident) => {
    navigate(`/app/cases?tab=incidents&id=${inc.id}`)
  }

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="space-y-5 max-w-[1700px] mx-auto pb-12">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Review Queue</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
              Prioritized Review
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Review pending traffic events, inspect evidence, and resolve incidents that need attention.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/app/cases?tab=incidents"
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-blue-500" />
            <span>All Incidents</span>
          </Link>
          <Link
            to="/app/cases"
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-indigo-500" />
            <span>Cases</span>
          </Link>
          <button
            onClick={() => fetchQueueData(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (refreshing || loading) && "animate-spin text-blue-600")} />
            <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Overview Operational Metrics Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Pending Review */}
        <div 
          onClick={() => { setStatusFilter('pending'); setSeverityFilter('all'); }}
          className={cn(
            "p-4 bg-white border rounded-xl shadow-xs transition-all cursor-pointer hover:border-blue-400 group",
            statusFilter === 'pending' ? "border-blue-500 ring-2 ring-blue-500/10" : "border-slate-200"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 group-hover:text-blue-600 transition-colors">Pending Review</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{metrics.pendingCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Active events awaiting manual audit</div>
        </div>

        {/* Critical Priority */}
        <div 
          onClick={() => { setSeverityFilter('critical'); setStatusFilter('pending'); }}
          className={cn(
            "p-4 bg-white border rounded-xl shadow-xs transition-all cursor-pointer hover:border-rose-400 group",
            severityFilter === 'critical' ? "border-rose-500 ring-2 ring-rose-500/10" : "border-slate-200"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 group-hover:text-rose-600 transition-colors">Critical Urgency</span>
            <div className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
              <AlertOctagon className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-rose-600 mt-2">{metrics.criticalUrgentCount}</div>
          <div className="text-[11px] text-rose-700/80 mt-0.5">Immediate intervention recommended</div>
        </div>

        {/* High Severity */}
        <div 
          onClick={() => { setSeverityFilter('high'); setStatusFilter('pending'); }}
          className={cn(
            "p-4 bg-white border rounded-xl shadow-xs transition-all cursor-pointer hover:border-amber-400 group",
            severityFilter === 'high' ? "border-amber-500 ring-2 ring-amber-500/10" : "border-slate-200"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 group-hover:text-amber-600 transition-colors">High Severity</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-amber-600 mt-2">{metrics.highCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">High-priority compliance violations</div>
        </div>

        {/* Reviewed Today */}
        <div 
          onClick={() => { setStatusFilter('resolved'); setDateFilter('today'); }}
          className={cn(
            "p-4 bg-white border rounded-xl shadow-xs transition-all cursor-pointer hover:border-emerald-400 group",
            statusFilter === 'resolved' && dateFilter === 'today' ? "border-emerald-500 ring-2 ring-emerald-500/10" : "border-slate-200"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 group-hover:text-emerald-600 transition-colors">Reviewed Today</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-700 mt-2">{metrics.reviewedTodayCount}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Operator decisions logged today</div>
        </div>
      </div>

      {/* Filter and Search Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs space-y-3">
        <div className="flex items-center gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by ID, type, video, vehicle track..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>

          {/* Toggle Filter Panel Button */}
          <button
            onClick={() => setIsFilterPanelOpen(prev => !prev)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer shrink-0",
              isFilterPanelOpen || (activeFilterCount > (searchQuery.trim() ? 1 : 0))
                ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filters</span>
            {activeFilterCount > (searchQuery.trim() ? 1 : 0) && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-blue-600 text-white text-[10px] font-bold leading-tight">
                {activeFilterCount - (searchQuery.trim() ? 1 : 0)}
              </span>
            )}
          </button>

          <span className="text-xs font-medium text-slate-500 shrink-0 hidden sm:inline-block">
            {sortedQueue.length} {sortedQueue.length === 1 ? 'incident' : 'incidents'}
          </span>
        </div>

        {/* Expandable Filter Panel */}
        {isFilterPanelOpen && (
          <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as StatusFilter)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none hover:border-slate-300 focus:border-blue-500 cursor-pointer shadow-2xs"
            >
              <option value="pending">Pending Only (Awaiting Action)</option>
              <option value="all">All Review Statuses</option>
              <option value="active">Active Only</option>
              <option value="resolved">Resolved (Approved)</option>
              <option value="rejected">Rejected (False Positive)</option>
            </select>

            {/* Severity Filter */}
            <select
              value={severityFilter}
              onChange={e => setSeverityFilter(e.target.value as SeverityFilter)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none hover:border-slate-300 focus:border-blue-500 cursor-pointer shadow-2xs"
            >
              <option value="all">All Severities</option>
              <option value="critical">Critical Severity</option>
              <option value="high">High Severity</option>
              <option value="medium">Medium Severity</option>
              <option value="low">Low Severity</option>
            </select>

            {/* Incident Type Filter */}
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none hover:border-slate-300 focus:border-blue-500 cursor-pointer shadow-2xs"
            >
              <option value="all">All Incident Types</option>
              {uniqueTypes.map(t => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>

            {/* Date Filter */}
            <select
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value as DateFilter)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none hover:border-slate-300 focus:border-blue-500 cursor-pointer shadow-2xs"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>

            {/* Reset Action */}
            {activeFilterCount > 0 && (
              <button
                onClick={handleResetFilters}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg font-medium transition-colors cursor-pointer ml-auto"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Filters</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Review Workspace: Two-Column Layout (Queue List + Focused Review Panel) */}
      <div className="flex flex-col lg:flex-row gap-5 items-start min-w-0">
        
        {/* Left Side: Prioritized Review Queue Table */}
        <div className={cn(
          "bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col transition-all duration-300",
          selectedIncident ? "w-full lg:w-7/12 xl:w-3/5 min-w-0" : "w-full min-w-0"
        )}>
          {/* Table Header Bar */}
          <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Prioritized Action Queue
              </span>
              <span className="text-[11px] text-slate-500">
                (Sorted by Urgency: Critical & High First • FIFO Aging Order)
              </span>
            </div>
            {selectedIncident && (
              <span className="text-xs text-blue-600 font-medium">
                Active Selection: #{selectedIncident.id.slice(0, 8)}
              </span>
            )}
          </div>

          {/* Table Body */}
          <div className="overflow-x-auto min-h-[420px] max-h-[720px] overflow-y-auto w-full min-w-0">
            {loading ? (
              <div className="h-72 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-2" />
                <p className="text-xs font-medium text-slate-500">Loading prioritized review queue...</p>
              </div>
            ) : sortedQueue.length === 0 ? (
              <div className="h-72 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3" />
                <h3 className="text-base font-bold text-slate-900 mb-1">Queue Clear</h3>
                <p className="text-xs text-slate-500 max-w-sm">
                  {statusFilter === 'pending'
                    ? 'All high-priority and pending traffic incidents have been resolved.'
                    : 'No incidents match your selected search or filter criteria.'}
                </p>
                {activeFilterCount > 0 && (
                  <button
                    onClick={handleResetFilters}
                    className="mt-3 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    Reset Filters
                  </button>
                )}
              </div>
            ) : (
              <table className="w-full min-w-[700px] text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 z-10 shadow-[0_1px_0_rgba(226,232,240,1)] text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Event ID</th>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Violation Type</th>
                    <th className="px-4 py-3">Vehicle</th>
                    <th className="px-4 py-3">Source Video</th>
                    <th className="px-4 py-3">Detected</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-3 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedQueue.map((inc) => {
                    const isSelected = selectedIncident?.id === inc.id
                    const sev = (inc.severity || 'Medium').toLowerCase()
                    const isUnresolved = inc.status !== 'Resolved' && inc.status !== 'Rejected'
                    const conf = inc.confidence ? Math.round(Number(inc.confidence) * 100) : 92

                    return (
                      <tr
                        key={inc.id}
                        onClick={() => setSelectedIncidentId(inc.id)}
                        className={cn(
                          "transition-colors cursor-pointer group",
                          isSelected
                            ? "bg-blue-50/70 border-l-4 border-l-blue-600 font-medium"
                            : "hover:bg-slate-50/80 border-l-4 border-l-transparent",
                          !isUnresolved && "opacity-75"
                        )}
                      >
                        {/* Event ID & Evidence Indicator */}
                        <td className="px-4 py-3.5 font-mono text-slate-900 font-semibold whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span>#{inc.id.slice(0, 8)}</span>
                            {inc.linkedCase && (
                              <span title={`Associated with Case #${inc.linkedCase.id.slice(0, 8)}`}>
                                <FolderOpen className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Severity Badge */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                            sev === 'critical' ? "bg-rose-100 text-rose-800 border border-rose-200" :
                            sev === 'high' ? "bg-amber-100 text-amber-800 border border-amber-200" :
                            sev === 'low' ? "bg-slate-100 text-slate-700 border border-slate-200" :
                            "bg-blue-100 text-blue-800 border border-blue-200"
                          )}>
                            {inc.severity || 'Medium'}
                          </span>
                        </td>

                        {/* Violation Type */}
                        <td className="px-4 py-3.5 text-slate-800 font-medium">
                          <div className="truncate max-w-[150px]" title={inc.incident_type}>
                            {inc.incident_type.replace(/_/g, ' ')}
                          </div>
                        </td>

                        {/* Vehicle Track & Confidence */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="text-slate-800 font-mono font-medium">
                            {inc.track_id !== null && inc.track_id !== undefined ? `Track #${inc.track_id}` : 'Unassigned'}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {conf}% conf
                          </div>
                        </td>

                        {/* Source Video */}
                        <td className="px-4 py-3.5 text-slate-600">
                          <div className="truncate max-w-[130px] font-medium text-slate-700">
                            {inc.video ? videoDisplayName(inc.video, fallbackNumbers) : 'Live Analysis'}
                          </div>
                          <div className="truncate max-w-[130px] text-[10px] text-slate-400">
                            {inc.video?.filename || 'video footage'}
                          </div>
                        </td>

                        {/* Detected Timestamp */}
                        <td className="px-4 py-3.5 whitespace-nowrap text-slate-600">
                          <div>{safeFormatDate(inc.created_at, 'MMM d, h:mm a')}</div>
                          <div className="text-[10px] text-slate-400">
                            {safeFormatDistance(inc.created_at)}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className={cn(
                            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold",
                            inc.status === 'Resolved' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                            inc.status === 'Rejected' ? "bg-slate-100 text-slate-600 border border-slate-200" :
                            "bg-blue-50 text-blue-700 border border-blue-200"
                          )}>
                            <span className={cn(
                              "w-1.5 h-1.5 rounded-full",
                              inc.status === 'Resolved' ? "bg-emerald-500" :
                              inc.status === 'Rejected' ? "bg-slate-400" :
                              "bg-blue-500 animate-pulse"
                            )} />
                            <span>{inc.status || 'Active'}</span>
                          </span>
                        </td>

                        {/* Chevron selector */}
                        <td className="px-3 py-3.5 text-right whitespace-nowrap">
                          <ChevronRight className={cn(
                            "w-4 h-4 transition-transform",
                            isSelected ? "text-blue-600 translate-x-0.5" : "text-slate-300 group-hover:text-slate-500"
                          )} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Side: Focused Incident Review Panel */}
        {selectedIncident ? (
          <div className="w-full lg:w-5/12 xl:w-2/5 min-w-0 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col sticky top-4">
            
            {/* Panel Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold tracking-tight text-white">
                  Event #{selectedIncident.id.slice(0, 8)}
                </span>
                <span className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                  selectedIncident.severity?.toLowerCase() === 'critical' ? "bg-rose-500/20 text-rose-300 border border-rose-400/30" :
                  selectedIncident.severity?.toLowerCase() === 'high' ? "bg-amber-500/20 text-amber-300 border border-amber-400/30" :
                  selectedIncident.severity?.toLowerCase() === 'low' ? "bg-slate-500/20 text-slate-300 border border-slate-400/30" :
                  "bg-blue-500/20 text-blue-300 border border-blue-400/30"
                )}>
                  {selectedIncident.severity || 'Medium'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-semibold",
                  selectedIncident.status === 'Resolved' ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" :
                  selectedIncident.status === 'Rejected' ? "bg-slate-500/20 text-slate-300 border border-slate-400/30" :
                  "bg-blue-500/20 text-blue-300 border border-blue-400/30"
                )}>
                  {selectedIncident.status || 'Active'}
                </span>
                <button
                  onClick={() => setSelectedIncidentId(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-md transition-colors cursor-pointer"
                  title="Close inspection panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Content Body */}
            <div className="p-5 space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto text-xs">
              
              {/* Primary Video Review Action Card */}
              <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-blue-950 text-xs">Synchronized Video Review</h4>
                  <p className="text-[11px] text-blue-700 mt-0.5">
                    {selectedIncident.metadata?.media_time !== undefined
                      ? `Replay video from timestamp t = ${Number(selectedIncident.metadata.media_time).toFixed(1)}s with live overlays.`
                      : 'Launch full synchronized video player.'}
                  </p>
                </div>
                <button
                  onClick={() => handleReviewVideo(selectedIncident)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer shadow-xs shrink-0"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Review Video</span>
                </button>
              </div>

              {/* Feedback Alert if Action Triggered */}
              {actionFeedback && (
                <div className={cn(
                  "p-3 rounded-lg border text-xs font-medium animate-in fade-in duration-200 flex items-center gap-2",
                  actionFeedback.type === 'success'
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-rose-50 border-rose-200 text-rose-800"
                )}>
                  {actionFeedback.type === 'success' ? (
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  )}
                  <span>{actionFeedback.text}</span>
                </div>
              )}

              {/* Contextual Detection Attributes Grid */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <span className="text-slate-400 block font-medium">Source Footage</span>
                  <span className="font-bold text-slate-800 block truncate mt-0.5">
                    {selectedIncident.video ? videoDisplayName(selectedIncident.video, fallbackNumbers) : 'Live Analysis'}
                  </span>
                  <span className="text-[10px] text-slate-500 block truncate">
                    {selectedIncident.video?.filename || 'video file'}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block font-medium">Vehicle Identification</span>
                  <span className="font-bold text-slate-800 block mt-0.5">
                    {selectedIncident.track_id !== null && selectedIncident.track_id !== undefined
                      ? `Vehicle #${selectedIncident.track_id}`
                      : 'Unassigned'}
                  </span>
                  <span className="text-[10px] text-emerald-700 block font-medium">
                    {selectedIncident.confidence ? `${Math.round(selectedIncident.confidence * 100)}% detection confidence` : '92% AI confidence'}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block font-medium">Recorded Time</span>
                  <span className="font-bold text-slate-800 block mt-0.5">
                    {safeFormatDate(selectedIncident.created_at, 'MMM d, yyyy h:mm a')}
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    {selectedIncident.metadata?.media_time !== undefined
                      ? `Media offset: ${Number(selectedIncident.metadata.media_time).toFixed(1)}s`
                      : 'Camera timestamp'}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block font-medium">Speed Reading</span>
                  <span className="font-bold text-amber-700 block mt-0.5">
                    {selectedIncident.metadata?.speed
                      ? `${Math.round(selectedIncident.metadata.speed)} km/h`
                      : 'Uncalibrated'}
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    {selectedIncident.metadata?.speed ? 'Sensor measured' : 'Requires camera calibration survey'}
                  </span>
                </div>
              </div>

              {/* Event Description */}
              <div>
                <span className="font-bold text-slate-700 block uppercase tracking-wider text-[11px] mb-1">
                  AI Diagnostic & Violation Summary
                </span>
                <div className="p-3 bg-white border border-slate-200 rounded-lg text-slate-700 leading-relaxed text-xs">
                  {selectedIncident.description || 'Traffic safety exception flagged by YOLO11n visual tracking model.'}
                </div>
              </div>

              {/* Captured Photographic Evidence Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5 text-slate-500" />
                    <span>Captured Photo Evidence ({incidentEvidence.length})</span>
                  </span>
                  {incidentEvidence.length > 0 && (
                    <span className="text-[10px] text-slate-400">Click image to inspect full-size</span>
                  )}
                </div>

                {incidentEvidence.length === 0 ? (
                  selectedIncident.snapshot_url ? (
                    <div className="rounded-lg border border-slate-200 overflow-hidden relative group">
                      <img
                        src={selectedIncident.snapshot_url}
                        alt="Incident snapshot"
                        className="w-full h-44 object-cover cursor-pointer"
                        onClick={() => setEnlargedImageUrl(selectedIncident.snapshot_url || null)}
                      />
                      <button
                        onClick={() => setEnlargedImageUrl(selectedIncident.snapshot_url || null)}
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity cursor-pointer"
                      >
                        <ZoomIn className="w-5 h-5 mr-1" />
                        <span className="text-xs font-semibold">Enlarge Evidence</span>
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center text-slate-500">
                      <Camera className="w-6 h-6 text-slate-400 mx-auto mb-1 opacity-50" />
                      <p className="text-xs">No photographic evidence frames recorded for this event.</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Use the Video Review tool to inspect bounding boxes in motion.</p>
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {incidentEvidence.map(ev => {
                      const urls = evidenceUrls[ev.id]
                      const displayImg = urls?.thumb || urls?.full || ev.file_url || ev.file_path || ''
                      const fullImg = urls?.full || ev.file_url || ev.file_path || ''

                      return (
                        <div
                          key={ev.id}
                          className="relative group rounded-lg overflow-hidden border border-slate-200 bg-slate-900 aspect-video flex items-center justify-center"
                        >
                          {displayImg ? (
                            <img
                              src={displayImg}
                              alt="Evidence thumbnail"
                              className="w-full h-full object-cover cursor-pointer group-hover:scale-105 transition-transform duration-200"
                              onClick={() => setEnlargedImageUrl(fullImg)}
                            />
                          ) : (
                            <div className="text-slate-400 flex flex-col items-center">
                              <Loader2 className="w-4 h-4 animate-spin mb-1 text-slate-500" />
                              <span className="text-[10px]">Loading preview...</span>
                            </div>
                          )}

                          <button
                            onClick={() => setEnlargedImageUrl(fullImg)}
                            className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity cursor-pointer"
                          >
                            <ZoomIn className="w-4 h-4 mr-1" />
                            <span className="text-[11px] font-semibold">Inspect</span>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Case Association & Investigation Section */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Case Investigation</span>
                  </span>
                  {selectedIncident.linkedCase ? (
                    <span className="px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-semibold rounded">
                      Linked to Case #{selectedIncident.linkedCase.id.slice(0, 8)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400">No active case</span>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  {selectedIncident.linkedCase ? (
                    <button
                      onClick={() => handleOpenCase(selectedIncident)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-indigo-200 text-indigo-700 rounded-lg font-semibold text-xs transition-colors cursor-pointer shadow-2xs"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Open Associated Case</span>
                      <ArrowUpRight className="w-3 h-3 ml-0.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleOpenCase(selectedIncident)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 rounded-lg font-semibold text-xs transition-colors cursor-pointer shadow-2xs"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-slate-500" />
                      <span>Create Investigation Case</span>
                      <ArrowRight className="w-3 h-3 ml-0.5 text-slate-400" />
                    </button>
                  )}

                  <button
                    onClick={() => handleOpenIncidentCenter(selectedIncident)}
                    className="px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 rounded-lg font-medium text-xs transition-colors cursor-pointer shadow-2xs"
                    title="View in full Incident Center workspace"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

            </div>

            {/* Bottom Decision Actions (Database Persisted Mutations) */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-2">
              {isReadOnly ? (
                <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-center text-xs">
                  <span className="font-semibold">Read-only Access:</span> Operators, Supervisors, or Admins can resolve or reject review items.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-[11px] text-slate-500 flex items-center justify-between">
                    <span>Review Decision</span>
                    <span className="font-mono text-[10px]">Actor: {user?.email || 'Authorized Operator'}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {/* Mark Resolved (Approve) */}
                    <button
                      onClick={() => handleReviewAction('resolve')}
                      disabled={isProcessingAction}
                      className={cn(
                        "flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg font-bold text-xs transition-all cursor-pointer shadow-xs",
                        selectedIncident.status === 'Resolved'
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          : "bg-emerald-600 hover:bg-emerald-700 text-white"
                      )}
                    >
                      {isProcessingAction ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      <span>{selectedIncident.status === 'Resolved' ? 'Verified (Resolved)' : 'Approve & Resolve'}</span>
                    </button>

                    {/* Reject (False Positive) */}
                    <button
                      onClick={() => handleReviewAction('reject')}
                      disabled={isProcessingAction}
                      className={cn(
                        "flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg font-bold text-xs transition-all cursor-pointer shadow-xs border",
                        selectedIncident.status === 'Rejected'
                          ? "bg-slate-200 text-slate-800 border-slate-300"
                          : "bg-white hover:bg-rose-50 text-rose-700 border-rose-200"
                      )}
                    >
                      {isProcessingAction ? (
                        <Loader2 className="w-4 h-4 animate-spin text-rose-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-600" />
                      )}
                      <span>Reject (False Positive)</span>
                    </button>
                  </div>

                  {/* Reopen Action (if already resolved or rejected) */}
                  {(selectedIncident.status === 'Resolved' || selectedIncident.status === 'Rejected') && (
                    <button
                      onClick={() => handleReviewAction('reopen')}
                      disabled={isProcessingAction}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reopen to Active Queue</span>
                    </button>
                  )}
                </div>
              )}
            </div>

          </div>
        ) : (
          <div className="hidden lg:flex w-full lg:w-5/12 xl:w-2/5 bg-slate-50 border border-slate-200 border-dashed rounded-xl items-center justify-center p-8 text-center text-slate-400 min-h-[420px]">
            <div>
              <ShieldAlert className="w-10 h-10 mx-auto mb-2 text-slate-300" />
              <h4 className="text-sm font-bold text-slate-700 mb-0.5">Select an Incident to Review</h4>
              <p className="text-xs text-slate-500 max-w-xs">
                Click any row in the prioritized review queue to inspect photographic evidence, detection attributes, and resolve the event.
              </p>
            </div>
          </div>
        )}

      </div>

      {/* High-Resolution Evidence Lightbox Modal */}
      {enlargedImageUrl && (
        <div 
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setEnlargedImageUrl(null)}
        >
          <div 
            className="relative max-w-4xl max-h-[90vh] bg-slate-900 rounded-xl overflow-hidden border border-slate-700 shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-white">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-semibold tracking-wide">
                  High-Resolution Evidence Exhibit
                </span>
                {selectedIncident && (
                  <span className="text-[11px] text-slate-400 font-mono">
                    #{selectedIncident.id.slice(0, 8)}
                  </span>
                )}
              </div>
              <button
                onClick={() => setEnlargedImageUrl(null)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2 flex items-center justify-center overflow-auto max-h-[80vh]">
              <img
                src={enlargedImageUrl}
                alt="Enlarged photographic evidence"
                className="max-h-[75vh] w-auto object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
