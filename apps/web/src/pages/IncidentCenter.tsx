import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { 
  ShieldAlert, Search, Filter, CheckCircle2, Clock, 
  MapPin, User, ChevronRight, X, Play, RotateCcw,
  AlertTriangle, AlertOctagon, Car, Film, ExternalLink,
  Check, XCircle, ArrowUpRight, Eye, RefreshCw, Loader2,
  FileText, Layers, FolderOpen, Camera
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import type { VideoAsset, AnalysisRun } from '../services/db'
import { fallbackVideoNumbers, videoDisplayName } from '../lib/videoAssets'
import { subDays, startOfDay, format as formatDate, formatDistanceToNow } from 'date-fns'

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

export interface IncidentRecord {
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
  metadata: Record<string, any> | null
  cameras?: { name: string } | null
  video?: VideoAsset | null
  linkedCase?: { id: string; status?: string; title?: string } | null
}

export interface EvidenceRecord {
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

type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'
type StatusFilter = 'all' | 'active' | 'resolved' | 'rejected'
type DateFilter = 'all' | 'today' | '7d' | '30d'

// ============================================================================
// Component
// ============================================================================

export function IncidentCenter() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuthStore()

  // Tab mode
  const activeTab = searchParams.get('tab') === 'review' ? 'review' : 'registry'
  const isReviewTab = activeTab === 'review'

  // Data states
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [incidents, setIncidents] = useState<IncidentRecord[]>([])
  const [videos, setVideos] = useState<VideoAsset[]>([])
  const [runs, setRuns] = useState<AnalysisRun[]>([])
  const [evidenceList, setEvidenceList] = useState<EvidenceRecord[]>([])
  const [cases, setCases] = useState<{ id: string; incident_id: string | null; status?: string; title?: string }[]>([])

  // Selection states
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    searchParams.get('id') || null
  )

  // Review action states
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState<string>('')
  const [isSavingNotes, setIsSavingNotes] = useState(false)

  // Filters
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [videoFilter, setVideoFilter] = useState<string>('all')

  const pendingCount = useMemo(() => {
    return incidents.filter(i => i.status !== 'Resolved' && i.status !== 'Rejected').length
  }, [incidents])

  // URL sync helper
  const handleSelectIncident = (id: string | null) => {
    setSelectedIncidentId(id)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (id) {
        next.set('id', id)
      } else {
        next.delete('id')
      }
      return next
    }, { replace: true })
  }

  // --------------------------------------------------------------------------
  // Data Loading
  // --------------------------------------------------------------------------
  useEffect(() => {
    loadAllIncidentData()
  }, [])

  // Listen for search param changes externally (e.g. browser back/forward)
  useEffect(() => {
    const paramId = searchParams.get('id')
    if (paramId && paramId !== selectedIncidentId) {
      if (incidents.some(i => i && i.id === paramId)) {
        setSelectedIncidentId(paramId)
      }
    }
  }, [searchParams, incidents])

  const loadAllIncidentData = async () => {
    setLoading(true)
    setError(null)
    try {
      let incData: any[] = []
      let incFetchError: any = null

      // Resilient concurrent fetch: failures in secondary tables will not abort the main list
      const [incRes, vidRes, runsRes] = await Promise.allSettled([
        supabase.from('incidents').select('*, cameras(name)').order('created_at', { ascending: false }),
        supabase.from('video_assets').select('*').order('uploaded_at', { ascending: false }),
        supabase.from('analysis_runs').select('*').order('started_at', { ascending: false })
      ])

      // 1. Process incidents with graceful fallback if cameras join fails
      if (incRes.status === 'fulfilled') {
        if (incRes.value.error) {
          console.warn('Direct incidents with cameras join failed, attempting basic query:', incRes.value.error)
          const fallback = await supabase.from('incidents').select('*').order('created_at', { ascending: false })
          if (fallback.error) {
            incFetchError = fallback.error
          } else {
            incData = fallback.data || []
          }
        } else {
          incData = incRes.value.data || []
        }
      } else {
        console.warn('Incidents query promise rejected, attempting basic query:', incRes.reason)
        const fallback = await supabase.from('incidents').select('*').order('created_at', { ascending: false })
        if (fallback.error) {
          incFetchError = fallback.error
        } else {
          incData = fallback.data || []
        }
      }

      if (incFetchError) {
        setError(`Failed to retrieve incident records: ${incFetchError.message || String(incFetchError)}`)
      }

      // 2. Process videos & runs safely
      const fetchedVideos = (vidRes.status === 'fulfilled' && !vidRes.value.error && vidRes.value.data)
        ? (vidRes.value.data as VideoAsset[])
        : []
      const fetchedRuns = (runsRes.status === 'fulfilled' && !runsRes.value.error && runsRes.value.data)
        ? (runsRes.value.data as AnalysisRun[])
        : []

      // Map videos onto incident records
      const videoMap = new Map<string, VideoAsset>()
      fetchedVideos.forEach(v => {
        if (v && v.id) videoMap.set(v.id, v)
      })

      const fetchedIncidents = (incData as IncidentRecord[])
        .filter(inc => inc && inc.id)
        .map(inc => ({
          ...inc,
          video: inc.video_id ? videoMap.get(inc.video_id) || null : null
        }))

      setVideos(fetchedVideos)
      setRuns(fetchedRuns)
      setIncidents(fetchedIncidents)

      // Initial selection synchronization
      const paramId = searchParams.get('id')
      if (paramId && fetchedIncidents.some(i => i.id === paramId)) {
        setSelectedIncidentId(paramId)
      } else if (fetchedIncidents.length > 0 && !selectedIncidentId) {
        setSelectedIncidentId(fetchedIncidents[0].id)
      }

      // 3. Optional secondary data (Evidence & Cases) - never blocks incident list rendering
      supabase
        .from('evidence')
        .select('id, incident_id, file_path, thumbnail_path, file_type, created_at')
        .then(evRes => {
          if (!evRes.error && evRes.data) {
            setEvidenceList(evRes.data as EvidenceRecord[])
          }
        })
        .catch(err => {
          console.warn('Optional evidence lookup error:', err)
        })

      supabase
        .from('cases')
        .select('id, incident_id, status')
        .then(casesRes => {
          if (!casesRes.error && casesRes.data) {
            setCases(casesRes.data)
          } else {
            // Fallback in case incident_id does not exist
            supabase
              .from('cases')
              .select('id, status')
              .then(fb => {
                if (!fb.error && fb.data) setCases(fb.data)
              })
              .catch(() => {})
          }
        })
        .catch(err => {
          console.warn('Optional cases lookup error:', err)
        })

    } catch (err: any) {
      console.error('Failed to load Incident Center data:', err)
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  const fallbackNumbers = useMemo(() => fallbackVideoNumbers(videos), [videos])

  // Fast map of cases by incident_id and by case id
  const { casesByIncidentId, casesById } = useMemo(() => {
    const byIncidentId = new Map<string, { id: string; status?: string; title?: string }>()
    const byId = new Map<string, { id: string; status?: string; title?: string }>()
    cases.forEach(c => {
      if (c && c.id) {
        byId.set(c.id, c)
      }
      if (c && c.incident_id) {
        byIncidentId.set(c.incident_id, c)
      }
    })
    return { casesByIncidentId: byIncidentId, casesById: byId }
  }, [cases])

  // Unique incident types for the filter dropdown
  const uniqueIncidentTypes = useMemo(() => {
    const set = new Set<string>()
    incidents.forEach(inc => {
      if (inc && inc.incident_type) set.add(inc.incident_type)
    })
    return Array.from(set).sort()
  }, [incidents])

  // --------------------------------------------------------------------------
  // Filtering Logic
  // --------------------------------------------------------------------------
  const filteredIncidents = useMemo(() => {
    const now = new Date()
    let dateCutoff: Date | null = null
    if (dateFilter === 'today') dateCutoff = startOfDay(now)
    else if (dateFilter === '7d') dateCutoff = subDays(now, 7)
    else if (dateFilter === '30d') dateCutoff = subDays(now, 30)

    const q = searchQuery.trim().toLowerCase()

    const list = incidents.filter(inc => {
      if (!inc || !inc.id) return false

      // If in review queue tab, only show unconfirmed/pending items
      if (isReviewTab && (inc.status === 'Resolved' || inc.status === 'Rejected')) {
        return false
      }

      // 1. Search Query
      if (q) {
        const idMatch = (inc.id || '').toLowerCase().includes(q)
        const typeMatch = (inc.incident_type || '').toLowerCase().includes(q)
        const descMatch = (inc.description || '').toLowerCase().includes(q)
        const videoMatch = (inc.video?.filename || '').toLowerCase().includes(q)
        const trackMatch = inc.track_id !== null && inc.track_id !== undefined && String(inc.track_id) === q
        if (!idMatch && !typeMatch && !descMatch && !videoMatch && !trackMatch) return false
      }

      // 2. Severity
      if (severityFilter !== 'all') {
        const s = (inc.severity || 'Medium').toLowerCase()
        if (severityFilter === 'critical' && s !== 'critical') return false
        if (severityFilter === 'high' && s !== 'high') return false
        if (severityFilter === 'medium' && s !== 'medium') return false
        if (severityFilter === 'low' && s !== 'low') return false
      }

      // 3. Incident Type
      if (typeFilter !== 'all' && inc.incident_type !== typeFilter) {
        return false
      }

      // 4. Status (only if not restricted to pending by review tab)
      if (!isReviewTab && statusFilter !== 'all') {
        const st = (inc.status || 'Active').toLowerCase()
        if (statusFilter === 'active' && st !== 'active') return false
        if (statusFilter === 'resolved' && st !== 'resolved') return false
        if (statusFilter === 'rejected' && (st !== 'rejected' && st !== 'dismissed')) return false
      }

      // 5. Date Cutoff
      if (dateCutoff) {
        const incDate = inc.created_at ? new Date(inc.created_at) : null
        if (!incDate || isNaN(incDate.getTime()) || incDate < dateCutoff) {
          return false
        }
      }

      // 6. Video
      if (videoFilter !== 'all' && inc.video_id !== videoFilter) {
        return false
      }

      return true
    })

    if (isReviewTab) {
      return [...list].sort((a, b) => {
        const getScore = (inc: IncidentRecord) => {
          const s = (inc.severity || 'Medium').toLowerCase()
          if (s === 'critical') return 400
          if (s === 'high') return 300
          if (s === 'medium') return 200
          return 100
        }
        const diff = getScore(b) - getScore(a)
        if (diff !== 0) return diff
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
    }

    return list
  }, [incidents, searchQuery, severityFilter, typeFilter, statusFilter, dateFilter, videoFilter, isReviewTab])

  // Keep selected incident synchronized with filtered set
  useEffect(() => {
    if (filteredIncidents.length === 0) {
      setSelectedIncidentId(null)
    } else if (selectedIncidentId && !filteredIncidents.some(i => i.id === selectedIncidentId)) {
      setSelectedIncidentId(filteredIncidents[0].id)
    } else if (!selectedIncidentId && filteredIncidents.length > 0) {
      setSelectedIncidentId(filteredIncidents[0].id)
    }
  }, [filteredIncidents, selectedIncidentId])

  // Currently selected incident object
  const selectedIncident = useMemo(() => {
    if (!selectedIncidentId) return null
    return incidents.find(i => i && i.id === selectedIncidentId) || null
  }, [incidents, selectedIncidentId])

  // Synchronize review notes textarea when selected incident changes
  useEffect(() => {
    if (selectedIncident) {
      const meta = selectedIncident.metadata || {}
      setReviewNotes(meta.review_notes || '')
    } else {
      setReviewNotes('')
    }
  }, [selectedIncidentId, selectedIncident])

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (searchQuery.trim()) count++
    if (severityFilter !== 'all') count++
    if (typeFilter !== 'all') count++
    if (statusFilter !== 'all') count++
    if (dateFilter !== 'all') count++
    if (videoFilter !== 'all') count++
    return count
  }, [searchQuery, severityFilter, typeFilter, statusFilter, dateFilter, videoFilter])

  const handleResetFilters = () => {
    setSearchQuery('')
    setSeverityFilter('all')
    setTypeFilter('all')
    setStatusFilter('all')
    setDateFilter('all')
    setVideoFilter('all')
  }

  // --------------------------------------------------------------------------
  // Persisted Incident Status Updates
  // --------------------------------------------------------------------------
  const handleUpdateStatus = async (newStatus: 'Active' | 'Resolved' | 'Rejected') => {
    if (!selectedIncident) return
    setIsUpdatingStatus(true)
    setActionSuccessMsg(null)

    try {
      const isResolving = newStatus === 'Resolved' || newStatus === 'Rejected'
      const payload: Record<string, any> = {
        status: newStatus,
        resolved_at: isResolving ? new Date().toISOString() : null,
        assigned_to: user?.id || null
      }

      let { error: updErr } = await supabase
        .from('incidents')
        .update(payload)
        .eq('id', selectedIncident.id)

      // Fallback if assigned_to fails foreign key constraint against profiles
      if (updErr && updErr.message && updErr.message.includes('assigned_to')) {
        delete payload.assigned_to
        const retry = await supabase.from('incidents').update(payload).eq('id', selectedIncident.id)
        updErr = retry.error
      }

      if (updErr) throw updErr

      // Update local state
      setIncidents(prev =>
        prev.map(item =>
          item.id === selectedIncident.id
            ? { ...item, status: newStatus, resolved_at: payload.resolved_at, assigned_to: payload.assigned_to }
            : item
        )
      )

      setActionSuccessMsg(`Incident #${(selectedIncident.id || '').slice(0, 8)} marked as ${newStatus}.`)
      setTimeout(() => setActionSuccessMsg(null), 4000)
    } catch (err: any) {
      console.error('Failed to update incident status:', err)
      setError(`Status update failed: ${err.message || String(err)}`)
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  const handleSaveNotes = async () => {
    if (!selectedIncident) return
    setIsSavingNotes(true)
    setActionSuccessMsg(null)

    try {
      const existingMeta = selectedIncident.metadata || {}
      const updatedMeta = { ...existingMeta, review_notes: reviewNotes.trim() }

      const { error: updErr } = await supabase
        .from('incidents')
        .update({ metadata: updatedMeta })
        .eq('id', selectedIncident.id)

      if (updErr) throw updErr

      setIncidents(prev =>
        prev.map(item =>
          item.id === selectedIncident.id ? { ...item, metadata: updatedMeta } : item
        )
      )

      setActionSuccessMsg('Investigation notes saved.')
      setTimeout(() => setActionSuccessMsg(null), 3000)
    } catch (err: any) {
      console.error('Failed to save notes:', err)
      setError(`Notes save failed: ${err.message || String(err)}`)
    } finally {
      setIsSavingNotes(false)
    }
  }

  // --------------------------------------------------------------------------
  // Navigation to Video Review at Exact Timestamp
  // --------------------------------------------------------------------------
  const handleReviewVideoAtTimestamp = (inc: IncidentRecord) => {
    if (!inc.video_id) return
    const mediaTime = inc.metadata?.media_time
    const timeParam = typeof mediaTime === 'number' && Number.isFinite(mediaTime) ? `&time=${mediaTime}` : ''
    navigate(`/app/videos?video=${inc.video_id}${timeParam}&incident=${inc.id}`)
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
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Incident Center</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              Operations & Verification
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Review detected traffic events, inspect video evidence, and manage incident verification.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/app/cases"
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-indigo-500" />
            <span>Cases</span>
          </Link>
          <button
            onClick={loadAllIncidentData}
            title="Refresh Data"
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-3 border-b border-slate-200 pb-px">
        <button
          onClick={() => {
            setSearchParams(prev => {
              const next = new URLSearchParams(prev)
              next.delete('tab')
              return next
            }, { replace: true })
          }}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer",
            !isReviewTab
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <Layers className="w-4 h-4" />
          <span>Incident Registry</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
            {incidents.length}
          </span>
        </button>

        <button
          onClick={() => {
            setSearchParams(prev => {
              const next = new URLSearchParams(prev)
              next.set('tab', 'review')
              return next
            }, { replace: true })
          }}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer",
            isReviewTab
              ? "border-amber-600 text-amber-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <Clock className="w-4 h-4" />
          <span>Review Queue</span>
          {pendingCount > 0 ? (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
              {pendingCount} Pending
            </span>
          ) : (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
              0 Pending
            </span>
          )}
        </button>
      </div>

      {/* Review Queue Verification Callout */}
      {isReviewTab && (
        <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-900 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <span className="font-bold text-amber-950">Operator Verification Queue</span>
              <p className="text-[11px] text-amber-800 mt-0.5">
                Review pending traffic infractions prioritized by severity. Confirm detections, dismiss false positives, or escalate to formal cases.
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="font-bold text-amber-950">{filteredIncidents.length}</span>
            <span className="text-[11px] text-amber-700 block">requiring operator review</span>
          </div>
        </div>
      )}

      {/* Notifications / Alerts */}
      {actionSuccessMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center justify-between font-medium">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
          <button onClick={() => setActionSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs flex items-center justify-between font-medium">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadAllIncidentData}
              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-semibold cursor-pointer transition-colors"
            >
              Retry
            </button>
            <button onClick={() => setError(null)} className="text-rose-700 hover:text-rose-900 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs space-y-3">
        <div className="flex items-center gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by ID, type, description, vehicle track..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
        </div>

        {/* Expandable Filter Panel */}
        {isFilterPanelOpen && (
          <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
            {/* Severity Filter */}
            <select
              value={severityFilter}
              onChange={e => setSeverityFilter(e.target.value as SeverityFilter)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer"
            >
              <option value="all">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {/* Type Filter */}
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer"
            >
              <option value="all">All Event Types</option>
              {uniqueIncidentTypes.map(t => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ').toUpperCase()}
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as StatusFilter)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer"
            >
              <option value="all">All Review Statuses</option>
              <option value="active">Active (Unresolved)</option>
              <option value="resolved">Resolved</option>
              <option value="rejected">Rejected (False Positive)</option>
            </select>

            {/* Date Filter */}
            <select
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value as DateFilter)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>

            {/* Video Scope Filter */}
            <select
              value={videoFilter}
              onChange={e => setVideoFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer max-w-[200px] truncate"
            >
              <option value="all">All Source Videos</option>
              {videos.map(v => (
                <option key={v.id} value={v.id}>
                  {videoDisplayName(v, fallbackNumbers)}
                </option>
              ))}
            </select>

            {/* Reset Action */}
            {activeFilterCount > 0 && (
              <button
                onClick={handleResetFilters}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors ml-auto"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reset Filters</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Workspace: Master List + Incident Detail Panel */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center flex flex-col items-center shadow-xs">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
          <h3 className="text-sm font-bold text-slate-900">Loading Incident Workspace</h3>
          <p className="text-xs text-slate-500 mt-1">Retrieving traffic infractions and video evidence records...</p>
        </div>
      ) : error && incidents.length === 0 ? (
        <div className="bg-white border border-rose-200 rounded-xl p-16 text-center flex flex-col items-center shadow-xs bg-rose-50/20">
          <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-500 flex items-center justify-center mb-3">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900">Unable to Load Incidents</h3>
          <p className="text-xs text-rose-700 max-w-sm mt-1 mb-4">
            {error}
          </p>
          <button
            onClick={loadAllIncidentData}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry Connection</span>
          </button>
        </div>
      ) : incidents.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center flex flex-col items-center shadow-xs">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-500" />
          </div>
          <h3 className="text-base font-bold text-slate-900">No Traffic Incidents Recorded</h3>
          <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">
            No incidents or infractions have been registered yet from your analyzed footage.
          </p>
          <Link
            to="/app/analyze"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs"
          >
            Go to Live Analysis
          </Link>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-5 items-start min-w-0">
          
          {/* Master Table Area */}
          <div className={cn(
            "bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden transition-all duration-200",
            selectedIncident ? "w-full lg:w-[60%] min-w-0" : "w-full min-w-0"
          )}>
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50/60">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Incident Records ({filteredIncidents.length})
              </span>
              <span className="text-[11px] text-slate-400">
                Click a record to inspect details & evidence
              </span>
            </div>

            {filteredIncidents.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-500">
                No incidents match the active search and filter criteria.
                <div className="mt-2">
                  <button
                    onClick={handleResetFilters}
                    className="text-blue-600 hover:underline font-semibold cursor-pointer"
                  >
                    Clear Filters
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[720px] overflow-y-auto w-full min-w-0">
                <table className="w-full min-w-[620px] text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-2.5 font-bold text-slate-500 uppercase tracking-wider">ID & Event</th>
                      <th className="px-4 py-2.5 font-bold text-slate-500 uppercase tracking-wider">Severity</th>
                      <th className="px-4 py-2.5 font-bold text-slate-500 uppercase tracking-wider">Video Source</th>
                      <th className="px-4 py-2.5 font-bold text-slate-500 uppercase tracking-wider">Time</th>
                      <th className="px-4 py-2.5 font-bold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-2.5 font-bold text-slate-500 uppercase tracking-wider text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredIncidents.map(inc => {
                      if (!inc || !inc.id) return null
                      const isSelected = selectedIncidentId === inc.id
                      const hasEv = evidenceList.some(e => e && e.incident_id === inc.id)
                      const sev = (inc.severity || 'Medium').toLowerCase()
                      const linkedCase = (inc.metadata?.case_id ? { id: inc.metadata.case_id, title: inc.metadata?.case_title, status: casesById.get(inc.metadata.case_id)?.status } : null) || casesByIncidentId.get(inc.id) || null

                      return (
                        <tr
                          key={inc.id}
                          onClick={() => handleSelectIncident(inc.id)}
                          className={cn(
                            "hover:bg-blue-50/50 cursor-pointer transition-colors",
                            isSelected && "bg-blue-50/90 font-medium"
                          )}
                        >
                          {/* ID & Event */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-900">
                                #{(inc.id || '').slice(0, 8)}
                              </span>
                              {hasEv && (
                                <span title="Evidence frame captured" className="text-purple-600">
                                  <Camera className="w-3.5 h-3.5" />
                                </span>
                              )}
                              {linkedCase && (
                                <Link
                                  to={`/app/cases?id=${linkedCase.id}`}
                                  onClick={e => e.stopPropagation()}
                                  title={linkedCase.title || `Investigation #${(linkedCase.id || '').slice(0, 8)}`}
                                  className="text-indigo-600 hover:text-indigo-800"
                                >
                                  <FolderOpen className="w-3.5 h-3.5" />
                                </Link>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-600 mt-0.5 truncate max-w-[200px]">
                              {String(inc.incident_type || 'Traffic Event').replace(/_/g, ' ')}
                              {inc.track_id !== null && inc.track_id !== undefined && (
                                <span className="text-slate-400 font-mono ml-1.5">Track #{inc.track_id}</span>
                              )}
                            </div>
                          </td>

                          {/* Severity */}
                          <td className="px-4 py-3">
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

                          {/* Video */}
                          <td className="px-4 py-3">
                            <div className="text-slate-800 font-medium truncate max-w-[150px]">
                              {inc.video ? videoDisplayName(inc.video, fallbackNumbers) : 'Video Footage'}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate max-w-[150px]">
                              {inc.video?.filename || 'persisted footage'}
                            </div>
                          </td>

                          {/* Detection Time */}
                          <td className="px-4 py-3 text-slate-600">
                            <div>{safeFormatDate(inc.created_at, 'MMM d, h:mm a')}</div>
                            <div className="text-[10px] text-slate-400">
                              {safeFormatDistance(inc.created_at)}
                            </div>
                          </td>

                          {/* Review Status */}
                          <td className="px-4 py-3">
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

                          {/* Action */}
                          <td className="px-4 py-3 text-right">
                            <button
                              disabled={!inc.video_id}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleReviewVideoAtTimestamp(inc)
                              }}
                              title={inc.video_id ? "Review Video at Exact Timestamp" : "No video linked"}
                              className="p-1 rounded hover:bg-blue-100 disabled:opacity-30 disabled:hover:bg-transparent text-slate-500 hover:text-blue-700 transition-colors cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Incident Detail Panel */}
          {selectedIncident && (
            <div className="w-full lg:w-[40%] min-w-0 bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col sticky top-4">
              
              {/* Panel Header */}
              <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm">#{(selectedIncident.id || '').slice(0, 8)}</span>
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                      selectedIncident.status === 'Resolved' ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30" :
                      selectedIncident.status === 'Rejected' ? "bg-slate-500/20 text-slate-300 border border-slate-400/30" :
                      "bg-blue-500/20 text-blue-300 border border-blue-400/30"
                    )}>
                      {selectedIncident.status || 'Active'}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-200 mt-0.5">
                    {String(selectedIncident.incident_type || 'Traffic Event').replace(/_/g, ' ').toUpperCase()}
                  </h3>
                </div>

                <button
                  onClick={() => handleSelectIncident(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Panel Body */}
              <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
                
                {/* Primary Action Card: Review Video at Timestamp */}
                {selectedIncident.video_id ? (
                  <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-blue-950 text-xs">Synchronized Video Review</h4>
                      <p className="text-[11px] text-blue-700 mt-0.5">
                        {selectedIncident.metadata?.media_time !== undefined
                          ? `Seek to timestamp t = ${Number(selectedIncident.metadata.media_time).toFixed(1)}s with live bounding boxes.`
                          : 'Open video replay player with detection overlays.'}
                      </p>
                    </div>
                    <button
                      onClick={() => handleReviewVideoAtTimestamp(selectedIncident)}
                      className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer shadow-xs shrink-0"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Review Video</span>
                    </button>
                  </div>
                ) : (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-800 text-xs">Video Footage</h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        No video asset linked directly to this incident record.
                      </p>
                    </div>
                    <Link
                      to="/app/videos"
                      className="flex items-center gap-1.5 px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-semibold text-xs transition-colors cursor-pointer shrink-0"
                    >
                      <Film className="w-3.5 h-3.5" />
                      <span>Browse Library</span>
                    </Link>
                  </div>
                )}

                {/* Key Contextual Attributes */}
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div>
                    <span className="text-slate-400 block font-medium">Source Video</span>
                    <span className="font-bold text-slate-800 block truncate mt-0.5">
                      {selectedIncident.video ? videoDisplayName(selectedIncident.video, fallbackNumbers) : 'Video Footage'}
                    </span>
                    <span className="text-[10px] text-slate-500 block truncate">
                      {selectedIncident.video?.filename || 'persisted file'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block font-medium">Vehicle Track ID</span>
                    <span className="font-bold text-slate-800 block mt-0.5">
                      {selectedIncident.track_id !== null && selectedIncident.track_id !== undefined ? `Vehicle #${selectedIncident.track_id}` : 'Unassigned'}
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      {selectedIncident.confidence ? `${Math.round(selectedIncident.confidence * 100)}% detection confidence` : 'AI Detected'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block font-medium">Detected At</span>
                    <span className="font-bold text-slate-800 block mt-0.5">
                      {safeFormatDate(selectedIncident.created_at, 'MMM d, yyyy h:mm a')}
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      {selectedIncident.metadata?.media_time !== undefined
                        ? `Media offset: ${Number(selectedIncident.metadata.media_time).toFixed(1)}s`
                        : 'Video timestamp'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block font-medium">Evidence Captured</span>
                    <span className="font-bold text-slate-800 block mt-0.5">
                      {(() => {
                        const count = evidenceList.filter(e => e && e.incident_id === selectedIncident.id).length
                        return count > 0 ? `${count} frame${count > 1 ? 's' : ''}` : 'None'
                      })()}
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      {evidenceList.some(e => e && e.incident_id === selectedIncident.id) ? 'Captured in database' : 'Replay via video review'}
                    </span>
                  </div>

                  {selectedIncident.metadata?.speed !== undefined && selectedIncident.metadata?.speed !== null && !isNaN(Number(selectedIncident.metadata.speed)) && (
                    <div className="col-span-2">
                      <span className="text-slate-400 block font-medium">Speed Reading</span>
                      <span className="font-bold text-amber-700 block mt-0.5">
                        {Math.round(Number(selectedIncident.metadata.speed))} km/h
                      </span>
                      <span className="text-[10px] text-slate-500 block">Measured Velocity</span>
                    </div>
                  )}
                </div>

                {/* Description & Location */}
                <div>
                  <span className="font-bold text-slate-700 block uppercase tracking-wider text-[11px] mb-1">
                    Event Description
                  </span>
                  <div className="p-3 bg-white border border-slate-200 rounded-lg text-slate-700 leading-relaxed">
                    {selectedIncident.description || 'Traffic event flagged by computer vision detection engine.'}
                  </div>
                </div>

                {/* Case Management Integration */}
                <div className="pt-2 border-t border-slate-200">
                  <span className="font-bold text-slate-700 block uppercase tracking-wider text-[11px] mb-2">
                    Case Management
                  </span>
                  {(() => {
                    const linkedCase = (selectedIncident.metadata?.case_id ? { id: selectedIncident.metadata.case_id, title: selectedIncident.metadata?.case_title, status: casesById.get(selectedIncident.metadata.case_id)?.status } : null) || casesByIncidentId.get(selectedIncident.id) || null
                    return linkedCase ? (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">Associated Investigation</span>
                          <span className="font-bold text-slate-800 text-xs mt-0.5 block truncate max-w-[200px]">
                            {linkedCase.title || `Case #${(linkedCase.id || '').slice(0, 8)}`}
                          </span>
                        </div>
                        <Link
                          to={`/app/cases?id=${linkedCase.id}`}
                          className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
                        >
                          <span>Open Case</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    ) : (
                      <div className="p-3 bg-indigo-50/60 border border-indigo-200 rounded-lg flex items-center justify-between">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-indigo-700 block">Investigation</span>
                          <span className="text-xs text-indigo-950 font-medium block mt-0.5">
                            No case opened for this incident yet.
                          </span>
                        </div>
                        <Link
                          to={`/app/cases?createWithIncident=${selectedIncident.id}`}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold shadow-xs"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          <span>Create Case</span>
                        </Link>
                      </div>
                    )
                  })()}
                </div>

                {/* Review Status & Resolution Controls */}
                <div className="pt-2 border-t border-slate-200 space-y-3">
                  <span className="font-bold text-slate-700 block uppercase tracking-wider text-[11px]">
                    Incident Review Actions
                  </span>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => handleUpdateStatus('Resolved')}
                      disabled={isUpdatingStatus || selectedIncident.status === 'Resolved'}
                      className={cn(
                        "py-2 px-2.5 rounded-lg font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50",
                        selectedIncident.status === 'Resolved'
                          ? "bg-emerald-600 text-white"
                          : "bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200"
                      )}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Resolved</span>
                    </button>

                    <button
                      onClick={() => handleUpdateStatus('Active')}
                      disabled={isUpdatingStatus || selectedIncident.status === 'Active'}
                      className={cn(
                        "py-2 px-2.5 rounded-lg font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50",
                        selectedIncident.status === 'Active'
                          ? "bg-blue-600 text-white"
                          : "bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200"
                      )}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Active</span>
                    </button>

                    <button
                      onClick={() => handleUpdateStatus('Rejected')}
                      disabled={isUpdatingStatus || selectedIncident.status === 'Rejected'}
                      className={cn(
                        "py-2 px-2.5 rounded-lg font-bold text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer disabled:opacity-50",
                        selectedIncident.status === 'Rejected'
                          ? "bg-slate-700 text-white"
                          : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                      )}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>

                  {/* Investigation Notes */}
                  <div className="space-y-1.5 pt-1">
                    <label className="block text-[11px] font-bold text-slate-600">
                      Investigation Notes (Persisted to Record)
                    </label>
                    <textarea
                      rows={3}
                      value={reviewNotes}
                      onChange={e => setReviewNotes(e.target.value)}
                      placeholder="Add investigation remarks or resolution context..."
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="flex justify-end">
                      <button
                        onClick={handleSaveNotes}
                        disabled={isSavingNotes}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50"
                      >
                        {isSavingNotes ? 'Saving...' : 'Save Notes'}
                      </button>
                    </div>
                  </div>

                </div>

                {/* Secondary Actions */}
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
                  {selectedIncident.video_id && (
                    <Link
                      to={`/app/analyze?video=${selectedIncident.video_id}&reanalyze=true`}
                      className="text-blue-600 hover:underline flex items-center gap-1 font-semibold"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Analyze Video Again</span>
                    </Link>
                  )}
                  {selectedIncident.analysis_run_id && (
                    <span className="font-mono text-[11px] text-slate-400">
                      Run #{(selectedIncident.analysis_run_id || '').slice(0, 8)}
                    </span>
                  )}
                </div>

              </div>

            </div>
          )}

        </div>
      )}

    </div>
  )
}

export default IncidentCenter
