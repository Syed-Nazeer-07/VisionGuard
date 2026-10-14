import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { 
  FolderSearch, FolderOpen, MapPin, Clock, Shield, ShieldAlert,
  Image as ImageIcon, Video as VideoIcon, MessageSquare, Plus, 
  FileSignature, Loader2, Play, AlertTriangle, AlertOctagon, 
  CheckCircle2, X, ChevronRight, User, Eye, ArrowUpRight, 
  RefreshCw, Check, XCircle, Filter, Search, Camera, ZoomIn,
  Layers, RotateCcw, ExternalLink, Film
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import type { VideoAsset, AnalysisRun } from '../services/db'
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

export interface CaseRecord {
  id: string
  incident_id: string | null
  status: string
  assigned_to: string | null
  created_at: string
  updated_at: string
  incident?: any
  assignee?: { id: string; name: string | null; email: string | null; role?: string } | null
  title?: string
  priority?: string
  description?: string
  additional_incident_ids?: string[]
}

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
  case_id?: string | null
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

type CasesTab = 'cases' | 'incidents' | 'review'
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'
type IncidentStatusFilter = 'all' | 'active' | 'resolved' | 'rejected'
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

function setCaseMetadataCache(id: string, meta: { title?: string; priority?: string; description?: string; additional_incident_ids?: string[] }) {
  try {
    const existing = getCaseMetadataCache()
    existing[id] = { ...existing[id], ...meta }
    localStorage.setItem(LOCAL_STORAGE_CASE_META, JSON.stringify(existing))
  } catch (e) {
    console.warn('Could not cache case metadata:', e)
  }
}

// ============================================================================
// Main Component
// ============================================================================

export function Cases() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, role } = useAuthStore()

  // Determine active tab: 'cases' (default), 'incidents', or 'review'
  const rawTab = searchParams.get('tab')
  const activeTab: CasesTab = rawTab === 'incidents' ? 'incidents' : rawTab === 'review' ? 'review' : 'cases'
  const isReviewTab = activeTab === 'review'
  const isIncidentsTab = activeTab === 'incidents'

  // Data states
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [allIncidents, setAllIncidents] = useState<IncidentRecord[]>([])
  const [evidenceList, setEvidenceList] = useState<EvidenceRecord[]>([])
  const [videos, setVideos] = useState<VideoAsset[]>([])
  const [profiles, setProfiles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null)

  // --------------------------------------------------------------------------
  // Tab 1: Cases View State
  // --------------------------------------------------------------------------
  const [caseSearchQuery, setCaseSearchQuery] = useState('')
  const [caseStatusFilter, setCaseStatusFilter] = useState('All')
  const [casePriorityFilter, setCasePriorityFilter] = useState('All')
  const [caseDateFilter, setCaseDateFilter] = useState<DateFilter>('all')

  // Selected Case (Detail View when on Cases tab)
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(
    activeTab === 'cases' ? searchParams.get('id') : null
  )
  const selectedCase = useMemo(() => {
    if (activeTab !== 'cases' || !selectedCaseId) return null
    return cases.find(c => c.id === selectedCaseId) || null
  }, [cases, selectedCaseId, activeTab])

  // Case Details Sub-State (Evidence, Notes, Timeline)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [caseEvidence, setCaseEvidence] = useState<any[]>([])
  const [caseEvidenceUrls, setCaseEvidenceUrls] = useState<Record<string, { full: string; thumb: string }>>({})
  const [caseNotes, setCaseNotes] = useState<any[]>([])
  const [caseTimeline, setCaseTimeline] = useState<any[]>([])
  const [enlargedImageUrl, setEnlargedImageUrl] = useState<string | null>(null)

  // Note posting state
  const [newNote, setNewNote] = useState('')
  const [isSubmittingNote, setIsSubmittingNote] = useState(false)

  // Link Incident Modal (from inside case detail view)
  const [isLinkIncidentModalOpen, setIsLinkIncidentModalOpen] = useState(false)
  const [incidentToLink, setIncidentToLink] = useState('')

  // --------------------------------------------------------------------------
  // Tab 2 & 3: Incidents & Review Queue State
  // --------------------------------------------------------------------------
  const [incSearchQuery, setIncSearchQuery] = useState('')
  const [incSeverityFilter, setIncSeverityFilter] = useState<SeverityFilter>('all')
  const [incTypeFilter, setIncTypeFilter] = useState<string>('all')
  const [incStatusFilter, setIncStatusFilter] = useState<IncidentStatusFilter>('all')
  const [incDateFilter, setIncDateFilter] = useState<DateFilter>('all')
  const [incVideoFilter, setIncVideoFilter] = useState<string>('all')
  const [isIncFilterPanelOpen, setIsIncFilterPanelOpen] = useState(false)

  // Selected Incident (Inspector panel)
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    activeTab !== 'cases' ? searchParams.get('id') : null
  )

  // Incident status update & notes
  const [isUpdatingIncidentStatus, setIsUpdatingIncidentStatus] = useState(false)
  const [incidentReviewNotes, setIncidentReviewNotes] = useState('')
  const [isSavingIncidentNotes, setIsSavingIncidentNotes] = useState(false)

  // --------------------------------------------------------------------------
  // Create Case Modal state
  // --------------------------------------------------------------------------
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isCreatingCase, setIsCreatingCase] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createPriority, setCreatePriority] = useState('Medium')
  const [createInitialStatus, setCreateInitialStatus] = useState('New')
  const [createPrimaryIncidentId, setCreatePrimaryIncidentId] = useState<string>('')
  const [createAdditionalIncidents, setCreateAdditionalIncidents] = useState<string[]>([])
  const [createAssigneeId, setCreateAssigneeId] = useState<string>('')
  const [createDescription, setCreateDescription] = useState('')

  const fallbackNumbers = useMemo(() => fallbackVideoNumbers(videos), [videos])
  const canApprove = role === 'Supervisor' || role === 'Admin'

  // Count pending unconfirmed incidents for review queue badge
  const pendingIncidentsCount = useMemo(() => {
    return allIncidents.filter(i => i.status !== 'Resolved' && i.status !== 'Rejected').length
  }, [allIncidents])

  // Fast map of cases by incident ID and by case ID
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
      if (c?.additional_incident_ids) {
        c.additional_incident_ids.forEach(addId => {
          if (!byIncidentId.has(addId)) {
            byIncidentId.set(addId, c)
          }
        })
      }
    })
    return { casesByIncidentId: byIncidentId, casesById: byId }
  }, [cases])

  // Unique incident types for the filter dropdown
  const uniqueIncidentTypes = useMemo(() => {
    const set = new Set<string>()
    allIncidents.forEach(inc => {
      if (inc && inc.incident_type) set.add(inc.incident_type)
    })
    return Array.from(set).sort()
  }, [allIncidents])

  // --------------------------------------------------------------------------
  // Data Fetching
  // --------------------------------------------------------------------------
  const fetchAllData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      let rawCases: any[] = []
      let incData: any[] = []

      const [casesRes, incRes, vidRes, profRes, evRes] = await Promise.allSettled([
        supabase
          .from('cases')
          .select(`
            *,
            incident:incidents(*, camera:cameras(name, location)),
            assignee:profiles!cases_assigned_to_fkey(id, name, email, role)
          `)
          .order('created_at', { ascending: false }),
        supabase.from('incidents').select('*, cameras(name)').order('created_at', { ascending: false }),
        supabase.from('video_assets').select('*').order('uploaded_at', { ascending: false }),
        supabase.from('profiles').select('id, name, email, role'),
        supabase.from('evidence').select('id, incident_id, file_path, thumbnail_path, file_type, created_at')
      ])

      // 1. Process Cases
      if (casesRes.status === 'fulfilled' && !casesRes.value.error) {
        rawCases = casesRes.value.data || []
      } else {
        const fallbackRes = await supabase.from('cases').select('*').order('created_at', { ascending: false })
        rawCases = fallbackRes.data || []
      }

      // 2. Process Incidents
      if (incRes.status === 'fulfilled' && !incRes.value.error) {
        incData = incRes.value.data || []
      } else {
        const fallback = await supabase.from('incidents').select('*').order('created_at', { ascending: false })
        incData = fallback.data || []
      }

      // 3. Process Videos
      const fetchedVideos = (vidRes.status === 'fulfilled' && !vidRes.value.error && vidRes.value.data)
        ? (vidRes.value.data as VideoAsset[])
        : []
      const vidMap = new Map<string, VideoAsset>()
      fetchedVideos.forEach(v => vidMap.set(v.id, v))
      setVideos(fetchedVideos)

      // 4. Process Profiles
      const fetchedProfiles = (profRes.status === 'fulfilled' && !profRes.value.error && profRes.value.data)
        ? (profRes.value.data as any[])
        : []
      const profMap = new Map<string, any>()
      fetchedProfiles.forEach(p => profMap.set(p.id, p))
      setProfiles(fetchedProfiles)

      // 5. Process Evidence
      const fetchedEvidence = (evRes.status === 'fulfilled' && !evRes.value.error && evRes.value.data)
        ? (evRes.value.data as EvidenceRecord[])
        : []
      setEvidenceList(fetchedEvidence)

      // Map video info onto incident records
      const mappedIncidents: IncidentRecord[] = (incData as any[])
        .filter(inc => inc && inc.id)
        .map(inc => ({
          ...inc,
          video: inc.video_id ? vidMap.get(inc.video_id) || null : null
        }))
      setAllIncidents(mappedIncidents)

      const incMap = new Map<string, any>()
      mappedIncidents.forEach(i => incMap.set(i.id, i))

      // Hydrate case titles, priorities, and descriptions from cache or notes
      const metaCache = getCaseMetadataCache()
      const hydratedCases: CaseRecord[] = rawCases.map((c: any) => {
        const cached = metaCache[c.id] || {}
        const inc = c.incident || (c.incident_id ? incMap.get(c.incident_id) || null : null)
        const assignee = c.assignee || (c.assigned_to ? profMap.get(c.assigned_to) || null : null)
        const fallbackTitle = inc
          ? `${String(inc.incident_type || 'Traffic Event').replace(/_/g, ' ').toUpperCase()} Investigation`
          : `Investigation Case #${c.id.slice(0, 8)}`

        const fallbackPriority = inc?.severity === 'Critical' ? 'Critical' : inc?.severity === 'High' ? 'High' : 'Medium'

        return {
          ...c,
          incident: inc,
          assignee: assignee,
          title: cached.title || fallbackTitle,
          priority: cached.priority || fallbackPriority,
          description: cached.description || '',
          additional_incident_ids: cached.additional_incident_ids || []
        }
      })

      setCases(hydratedCases)

    } catch (err: any) {
      console.error('Failed to load cases workspace data:', err)
      setLoadError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAllData()
  }, [fetchAllData])

  // Synchronize URL search params with local state
  useEffect(() => {
    const paramId = searchParams.get('id')
    const currentTab = searchParams.get('tab') || 'cases'

    if (currentTab === 'cases') {
      setSelectedCaseId(paramId || null)
    } else {
      setSelectedIncidentId(paramId || null)
    }

    const createIncidentId = searchParams.get('createWithIncident')
    if (createIncidentId) {
      const handlePreFill = (matched: any) => {
        setCreatePrimaryIncidentId(matched.id)
        setCreateTitle(`[${String(matched.incident_type || 'Traffic').replace(/_/g, ' ').toUpperCase()}] Investigation`)
        setCreatePriority(matched.severity === 'Critical' ? 'Critical' : matched.severity === 'High' ? 'High' : 'Medium')
        setCreateDescription(matched.description || '')
        setIsCreateModalOpen(true)
      }

      const found = allIncidents.find(i => i.id === createIncidentId)
      if (found) {
        handlePreFill(found)
      } else {
        supabase.from('incidents').select('*, cameras(name)').eq('id', createIncidentId).maybeSingle().then(({ data }: any) => {
          if (data) handlePreFill(data)
        })
      }
    }
  }, [searchParams, allIncidents])

  // Fetch sub-details for the open case (Evidence, Notes, Timeline)
  const fetchCaseSubDetails = useCallback(async (caseId: string, primaryIncId?: string | null) => {
    setDetailsLoading(true)
    setActionError(null)

    try {
      const targetCase = cases.find(c => c.id === caseId)
      const linkedIncidentIds = new Set<string>()
      if (primaryIncId) linkedIncidentIds.add(primaryIncId)
      if (targetCase?.additional_incident_ids) {
        targetCase.additional_incident_ids.forEach(id => linkedIncidentIds.add(id))
      }

      // 1. Fetch Notes & Timeline
      const [notesRes, eventsRes, evRes] = await Promise.all([
        supabase
          .from('case_notes')
          .select('*, author:profiles(id, name, email)')
          .eq('case_id', caseId)
          .order('created_at', { ascending: true }),
        supabase
          .from('case_events')
          .select('*, actor:profiles(id, name, email)')
          .eq('case_id', caseId)
          .order('created_at', { ascending: false }),
        supabase
          .from('evidence')
          .select('*')
          .order('capture_timestamp', { ascending: false })
      ])

      let notes = notesRes.data || []
      if (notesRes.error) {
        const fb = await supabase.from('case_notes').select('*').eq('case_id', caseId).order('created_at', { ascending: true })
        notes = (fb.data || []).map((n: any) => ({
          ...n,
          author: profiles.find(p => p.id === n.author_id) || null
        }))
      }

      let events = eventsRes.data || []
      if (eventsRes.error) {
        const fb = await supabase.from('case_events').select('*').eq('case_id', caseId).order('created_at', { ascending: false })
        events = (fb.data || []).map((ev: any) => ({
          ...ev,
          actor: profiles.find(p => p.id === ev.actor_id) || null
        }))
      }

      setCaseNotes(notes)
      setCaseTimeline(events)

      // Filter evidence matching case or any linked incident
      const allEv = (evRes.data || []) as any[]
      const matchedEv = allEv.filter(ev => {
        if (ev.case_id === caseId) return true
        if (ev.incident_id && linkedIncidentIds.has(ev.incident_id)) return true
        return false
      })
      setCaseEvidence(matchedEv)

      // Resolve signed URLs
      const urlsMap: Record<string, { full: string; thumb: string }> = {}
      await Promise.all(
        matchedEv.map(async ev => {
          const path = ev.file_path || ev.file_url
          if (!path) return
          try {
            const [full, thumb] = await Promise.all([
              getSignedUrl(path),
              ev.thumbnail_path ? getSignedUrl(ev.thumbnail_path) : Promise.resolve('')
            ])
            if (full) urlsMap[ev.id] = { full, thumb: thumb || full }
          } catch (e) {
            console.warn('Evidence URL resolution error:', e)
          }
        })
      )
      setCaseEvidenceUrls(urlsMap)
    } catch (err: any) {
      console.error('Case sub-details error:', err)
      setActionError(`Could not load all case records: ${err.message}`)
    } finally {
      setDetailsLoading(false)
    }
  }, [cases, profiles])

  useEffect(() => {
    if (activeTab === 'cases' && selectedCaseId) {
      const c = cases.find(item => item.id === selectedCaseId)
      fetchCaseSubDetails(selectedCaseId, c?.incident_id)
    }
  }, [selectedCaseId, fetchCaseSubDetails, cases, activeTab])

  // --------------------------------------------------------------------------
  // Tab Switching Handler
  // --------------------------------------------------------------------------
  const handleSwitchTab = (tab: CasesTab) => {
    setActionError(null)
    setActionSuccessMsg(null)
    setSearchParams(prev => {
      const next = new URLSearchParams()
      if (tab !== 'cases') {
        next.set('tab', tab)
      }
      // If switching to incidents or review, keep selected incident id if present
      if (tab !== 'cases' && selectedIncidentId) {
        next.set('id', selectedIncidentId)
      }
      return next
    })
  }

  // --------------------------------------------------------------------------
  // Tab 1: Case Filtering
  // --------------------------------------------------------------------------
  const filteredCases = useMemo(() => {
    const now = new Date()
    let dateCutoff: Date | null = null
    if (caseDateFilter === 'today') dateCutoff = startOfDay(now)
    else if (caseDateFilter === '7d') dateCutoff = subDays(now, 7)
    else if (caseDateFilter === '30d') dateCutoff = subDays(now, 30)

    const q = caseSearchQuery.trim().toLowerCase()

    return cases.filter(c => {
      // 1. Search Query
      if (q) {
        const idMatch = c.id.toLowerCase().includes(q)
        const titleMatch = (c.title || '').toLowerCase().includes(q)
        const typeMatch = (c.incident?.incident_type || '').toLowerCase().includes(q)
        const assigneeMatch = (c.assignee?.name || c.assignee?.email || '').toLowerCase().includes(q)
        const cameraMatch = (c.incident?.camera?.name || '').toLowerCase().includes(q)
        if (!idMatch && !titleMatch && !typeMatch && !assigneeMatch && !cameraMatch) return false
      }

      // 2. Status
      if (caseStatusFilter !== 'All' && c.status !== caseStatusFilter) return false

      // 3. Priority
      if (casePriorityFilter !== 'All' && c.priority !== casePriorityFilter) return false

      // 4. Date
      if (dateCutoff && new Date(c.created_at) < dateCutoff) return false

      return true
    })
  }, [cases, caseSearchQuery, caseStatusFilter, casePriorityFilter, caseDateFilter])

  // Overview Metrics for Cases
  const overviewMetrics = useMemo(() => {
    let activeCount = 0
    let highOrCritCount = 0
    let closedCount = 0

    cases.forEach(c => {
      if (c.status === 'Closed' || c.status === 'Approved') closedCount++
      else activeCount++

      if (c.priority === 'Critical' || c.priority === 'High') highOrCritCount++
    })

    return {
      total: cases.length,
      active: activeCount,
      urgent: highOrCritCount,
      closed: closedCount
    }
  }, [cases])

  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'New': return "bg-blue-50 text-blue-700 border-blue-200"
      case 'Under Review': return "bg-amber-50 text-amber-700 border-amber-200"
      case 'Investigating': return "bg-purple-50 text-purple-700 border-purple-200"
      case 'Escalated': return "bg-rose-50 text-rose-700 border-rose-200"
      case 'Approved': return "bg-emerald-50 text-emerald-700 border-emerald-200"
      case 'Closed': return "bg-slate-100 text-slate-700 border-slate-300"
      default: return "bg-slate-50 text-slate-700 border-slate-200"
    }
  }

  const getPriorityBadgeStyle = (priority: string = 'Medium') => {
    switch (priority) {
      case 'Critical': return "bg-rose-100 text-rose-800 border-rose-200 font-bold"
      case 'High': return "bg-amber-100 text-amber-800 border-amber-200 font-bold"
      case 'Low': return "bg-slate-100 text-slate-700 border-slate-200"
      default: return "bg-blue-100 text-blue-800 border-blue-200"
    }
  }

  // All incidents associated with the currently open case
  const associatedIncidentsList = useMemo(() => {
    if (!selectedCase) return []
    const ids = new Set<string>()
    if (selectedCase.incident_id) ids.add(selectedCase.incident_id)
    if (selectedCase.additional_incident_ids) {
      selectedCase.additional_incident_ids.forEach(id => ids.add(id))
    }
    return allIncidents.filter(i => ids.has(i.id))
  }, [selectedCase, allIncidents])

  // --------------------------------------------------------------------------
  // Tab 2 & 3: Incident Filtering Logic
  // --------------------------------------------------------------------------
  const filteredIncidents = useMemo(() => {
    const now = new Date()
    let dateCutoff: Date | null = null
    if (incDateFilter === 'today') dateCutoff = startOfDay(now)
    else if (incDateFilter === '7d') dateCutoff = subDays(now, 7)
    else if (incDateFilter === '30d') dateCutoff = subDays(now, 30)

    const q = incSearchQuery.trim().toLowerCase()

    const list = allIncidents.filter(inc => {
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
      if (incSeverityFilter !== 'all') {
        const s = (inc.severity || 'Medium').toLowerCase()
        if (incSeverityFilter === 'critical' && s !== 'critical') return false
        if (incSeverityFilter === 'high' && s !== 'high') return false
        if (incSeverityFilter === 'medium' && s !== 'medium') return false
        if (incSeverityFilter === 'low' && s !== 'low') return false
      }

      // 3. Incident Type
      if (incTypeFilter !== 'all' && inc.incident_type !== incTypeFilter) {
        return false
      }

      // 4. Status (only if not restricted to pending by review tab)
      if (!isReviewTab && incStatusFilter !== 'all') {
        const st = (inc.status || 'Active').toLowerCase()
        if (incStatusFilter === 'active' && st !== 'active') return false
        if (incStatusFilter === 'resolved' && st !== 'resolved') return false
        if (incStatusFilter === 'rejected' && (st !== 'rejected' && st !== 'dismissed')) return false
      }

      // 5. Date Cutoff
      if (dateCutoff) {
        const incDate = inc.created_at ? new Date(inc.created_at) : null
        if (!incDate || isNaN(incDate.getTime()) || incDate < dateCutoff) {
          return false
        }
      }

      // 6. Video
      if (incVideoFilter !== 'all' && inc.video_id !== incVideoFilter) {
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
  }, [allIncidents, incSearchQuery, incSeverityFilter, incTypeFilter, incStatusFilter, incDateFilter, incVideoFilter, isReviewTab])

  // Keep selected incident synchronized with filtered set
  useEffect(() => {
    if (activeTab === 'cases') return
    if (filteredIncidents.length === 0) {
      setSelectedIncidentId(null)
    } else if (selectedIncidentId && !filteredIncidents.some(i => i.id === selectedIncidentId)) {
      setSelectedIncidentId(filteredIncidents[0].id)
    } else if (!selectedIncidentId && filteredIncidents.length > 0) {
      setSelectedIncidentId(filteredIncidents[0].id)
    }
  }, [filteredIncidents, selectedIncidentId, activeTab])

  // Currently selected incident object
  const selectedIncident = useMemo(() => {
    if (!selectedIncidentId) return null
    return allIncidents.find(i => i && i.id === selectedIncidentId) || null
  }, [allIncidents, selectedIncidentId])

  // Synchronize review notes textarea when selected incident changes
  useEffect(() => {
    if (selectedIncident) {
      const meta = selectedIncident.metadata || {}
      setIncidentReviewNotes(meta.review_notes || '')
    } else {
      setIncidentReviewNotes('')
    }
  }, [selectedIncidentId, selectedIncident])

  // Active filter count for incidents
  const activeIncFilterCount = useMemo(() => {
    let count = 0
    if (incSearchQuery.trim()) count++
    if (incSeverityFilter !== 'all') count++
    if (incTypeFilter !== 'all') count++
    if (incStatusFilter !== 'all') count++
    if (incDateFilter !== 'all') count++
    if (incVideoFilter !== 'all') count++
    return count
  }, [incSearchQuery, incSeverityFilter, incTypeFilter, incStatusFilter, incDateFilter, incVideoFilter])

  const handleResetIncFilters = () => {
    setIncSearchQuery('')
    setIncSeverityFilter('all')
    setIncTypeFilter('all')
    setIncStatusFilter('all')
    setIncDateFilter('all')
    setIncVideoFilter('all')
  }

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
  // Incident Status Updates & Notes
  // --------------------------------------------------------------------------
  const handleUpdateIncidentStatus = async (newStatus: 'Active' | 'Resolved' | 'Rejected') => {
    if (!selectedIncident) return
    setIsUpdatingIncidentStatus(true)
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

      if (updErr && updErr.message && updErr.message.includes('assigned_to')) {
        delete payload.assigned_to
        const retry = await supabase.from('incidents').update(payload).eq('id', selectedIncident.id)
        updErr = retry.error
      }

      if (updErr) throw updErr

      setAllIncidents(prev =>
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
      setActionError(`Status update failed: ${err.message || String(err)}`)
    } finally {
      setIsUpdatingIncidentStatus(false)
    }
  }

  const handleSaveIncidentNotes = async () => {
    if (!selectedIncident) return
    setIsSavingIncidentNotes(true)
    setActionSuccessMsg(null)

    try {
      const existingMeta = selectedIncident.metadata || {}
      const updatedMeta = { ...existingMeta, review_notes: incidentReviewNotes.trim() }

      const { error: updErr } = await supabase
        .from('incidents')
        .update({ metadata: updatedMeta })
        .eq('id', selectedIncident.id)

      if (updErr) throw updErr

      setAllIncidents(prev =>
        prev.map(item =>
          item.id === selectedIncident.id ? { ...item, metadata: updatedMeta } : item
        )
      )

      setActionSuccessMsg('Investigation notes saved.')
      setTimeout(() => setActionSuccessMsg(null), 3000)
    } catch (err: any) {
      console.error('Failed to save notes:', err)
      setActionError(`Notes save failed: ${err.message || String(err)}`)
    } finally {
      setIsSavingIncidentNotes(false)
    }
  }

  const handleReviewVideoAtTimestamp = (inc: IncidentRecord) => {
    if (!inc.video_id) return
    const mediaTime = inc.metadata?.media_time
    const timeParam = typeof mediaTime === 'number' && Number.isFinite(mediaTime) ? `&time=${mediaTime}` : ''
    navigate(`/app/videos?video=${inc.video_id}${timeParam}&incident=${inc.id}`)
  }

  const handleEscalateIncidentToCase = (inc: IncidentRecord) => {
    setCreatePrimaryIncidentId(inc.id)
    setCreateTitle(`[${String(inc.incident_type || 'Traffic').replace(/_/g, ' ').toUpperCase()}] Investigation`)
    setCreatePriority(inc.severity === 'Critical' ? 'Critical' : inc.severity === 'High' ? 'High' : 'Medium')
    setCreateDescription(inc.description || '')
    setIsCreateModalOpen(true)
  }

  const handleOpenLinkedCase = (caseId: string) => {
    setSelectedCaseId(caseId)
    setSearchParams({ tab: 'cases', id: caseId })
  }

  const handleOpenIncidentDetail = (incId: string) => {
    setSelectedIncidentId(incId)
    setSearchParams({ tab: 'incidents', id: incId })
  }

  // --------------------------------------------------------------------------
  // Case Creation Workflow
  // --------------------------------------------------------------------------
  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createTitle.trim()) {
      setActionError('Please specify a case title.')
      return
    }

    setIsCreatingCase(true)
    setActionError(null)

    try {
      const newCaseId = crypto.randomUUID()
      const nowIso = new Date().toISOString()

      // 1. Insert into public.cases
      const { error: insErr } = await supabase.from('cases').insert([{
        id: newCaseId,
        incident_id: createPrimaryIncidentId || null,
        status: createInitialStatus || 'New',
        assigned_to: createAssigneeId || null,
        created_at: nowIso,
        updated_at: nowIso
      }])

      if (insErr) throw insErr

      // 2. Cache title, priority, description, and linked incident IDs
      setCaseMetadataCache(newCaseId, {
        title: createTitle.trim(),
        priority: createPriority,
        description: createDescription.trim(),
        additional_incident_ids: createAdditionalIncidents
      })

      // 3. Insert initial investigation note if description was provided
      if (createDescription.trim()) {
        await supabase.from('case_notes').insert([{
          case_id: newCaseId,
          author_id: user?.id || null,
          note: `Investigation Scope:\n${createDescription.trim()}`
        }])
      }

      // 4. Insert initial audit event into case_events
      await supabase.from('case_events').insert([{
        case_id: newCaseId,
        actor_id: user?.id || null,
        action: `Case opened: "${createTitle.trim()}" (${createPriority} Priority)`
      }])

      // 5. Update linked incident metadata so the incident references this case
      if (createPrimaryIncidentId) {
        const prim = allIncidents.find(i => i.id === createPrimaryIncidentId)
        if (prim) {
          const meta = prim.metadata || {}
          await supabase.from('incidents').update({
            metadata: { ...meta, case_id: newCaseId, case_title: createTitle.trim() }
          }).eq('id', prim.id)
        }
      }

      for (const addId of createAdditionalIncidents) {
        const addInc = allIncidents.find(i => i.id === addId)
        if (addInc) {
          const meta = addInc.metadata || {}
          await supabase.from('incidents').update({
            metadata: { ...meta, case_id: newCaseId, case_title: createTitle.trim() }
          }).eq('id', addInc.id)
        }
      }

      // Close modal & reset form
      setIsCreateModalOpen(false)
      setCreateTitle('')
      setCreateDescription('')
      setCreatePrimaryIncidentId('')
      setCreateAdditionalIncidents([])
      setActionSuccessMsg(`Case "${createTitle.trim()}" created successfully.`)

      // Refresh and open the new case in Cases tab
      await fetchAllData()
      setSelectedCaseId(newCaseId)
      setSearchParams({ tab: 'cases', id: newCaseId })
      setTimeout(() => setActionSuccessMsg(null), 4000)
    } catch (err: any) {
      console.error('Case creation failed:', err)
      setActionError(`Case creation failed: ${err.message || String(err)}`)
    } finally {
      setIsCreatingCase(false)
    }
  }

  // --------------------------------------------------------------------------
  // Case Status Updates & Assignment
  // --------------------------------------------------------------------------
  const handleUpdateCaseStatus = async (newStatus: string) => {
    if (!selectedCase || !user) return
    if ((newStatus === 'Approved' || newStatus === 'Closed') && !canApprove) {
      setActionError('Only Supervisors and Admins can approve or close investigation cases.')
      return
    }

    setActionError(null)
    const prevStatus = selectedCase.status
    const nowIso = new Date().toISOString()

    try {
      const { error: updErr } = await supabase
        .from('cases')
        .update({ status: newStatus, updated_at: nowIso })
        .eq('id', selectedCase.id)

      if (updErr) throw updErr

      // Log timeline event
      await supabase.from('case_events').insert([{
        case_id: selectedCase.id,
        actor_id: user.id,
        action: `Status updated from ${prevStatus} to ${newStatus}`
      }])

      // Update local state
      setCases(prev =>
        prev.map(c => (c.id === selectedCase.id ? { ...c, status: newStatus, updated_at: nowIso } : c))
      )

      setActionSuccessMsg(`Case status changed to ${newStatus}.`)
      setTimeout(() => setActionSuccessMsg(null), 3000)
    } catch (err: any) {
      console.error('Status update error:', err)
      setActionError(`Status update failed: ${err.message || String(err)}`)
    }
  }

  const handleAssignInvestigator = async (assigneeId: string) => {
    if (!selectedCase || !user) return
    setActionError(null)

    try {
      const assignee = profiles.find(p => p.id === assigneeId)
      const nowIso = new Date().toISOString()

      const { error: updErr } = await supabase
        .from('cases')
        .update({ assigned_to: assigneeId || null, updated_at: nowIso })
        .eq('id', selectedCase.id)

      if (updErr) throw updErr

      await supabase.from('case_events').insert([{
        case_id: selectedCase.id,
        actor_id: user.id,
        action: assigneeId
          ? `Assigned investigation to ${assignee?.name || assignee?.email || 'Officer'}`
          : 'Investigation unassigned'
      }])

      setCases(prev =>
        prev.map(c => (c.id === selectedCase.id ? { ...c, assigned_to: assigneeId || null, assignee: assignee || null } : c))
      )

      setActionSuccessMsg(`Investigator assigned: ${assignee?.name || 'Unassigned'}`)
      setTimeout(() => setActionSuccessMsg(null), 3000)
    } catch (err: any) {
      console.error('Assignment error:', err)
      setActionError(`Assignment failed: ${err.message || String(err)}`)
    }
  }

  const handlePostNote = async (e: React.FormEvent) => {
    e.preventDefault()
    const noteText = newNote.trim()
    if (!noteText || !selectedCase || !user) return

    setIsSubmittingNote(true)
    setActionError(null)

    try {
      const { error: noteErr } = await supabase.from('case_notes').insert([{
        case_id: selectedCase.id,
        author_id: user.id,
        note: noteText
      }])

      if (noteErr) throw noteErr

      await supabase.from('case_events').insert([{
        case_id: selectedCase.id,
        actor_id: user.id,
        action: 'Added investigation note'
      }])

      setNewNote('')
      await fetchCaseSubDetails(selectedCase.id, selectedCase.incident_id)
      setActionSuccessMsg('Investigation note posted.')
      setTimeout(() => setActionSuccessMsg(null), 3000)
    } catch (err: any) {
      console.error('Failed to post note:', err)
      setActionError(`Could not save note: ${err.message || String(err)}`)
    } finally {
      setIsSubmittingNote(false)
    }
  }

  const handleLinkIncident = async () => {
    if (!selectedCase || !incidentToLink) return

    try {
      const inc = allIncidents.find(i => i.id === incidentToLink)
      if (!inc) return

      const existingAdditional = selectedCase.additional_incident_ids || []
      if (!existingAdditional.includes(incidentToLink)) {
        const updated = [...existingAdditional, incidentToLink]
        setCaseMetadataCache(selectedCase.id, { additional_incident_ids: updated })

        // Update incident metadata to link to case
        const meta = inc.metadata || {}
        await supabase.from('incidents').update({
          metadata: { ...meta, case_id: selectedCase.id, case_title: selectedCase.title }
        }).eq('id', inc.id)

        await supabase.from('case_events').insert([{
          case_id: selectedCase.id,
          actor_id: user?.id || null,
          action: `Linked Incident #${inc.id.slice(0, 8)} (${inc.incident_type}) to case`
        }])

        // Update local state
        setCases(prev =>
          prev.map(c => (c.id === selectedCase.id ? { ...c, additional_incident_ids: updated } : c))
        )

        setIsLinkIncidentModalOpen(false)
        setIncidentToLink('')
        await fetchCaseSubDetails(selectedCase.id, selectedCase.incident_id)
        setActionSuccessMsg(`Incident #${inc.id.slice(0, 8)} associated with case.`)
        setTimeout(() => setActionSuccessMsg(null), 3000)
      }
    } catch (err: any) {
      console.error('Link incident error:', err)
      setActionError(`Could not link incident: ${err.message}`)
    }
  }

  // Handle direct navigation to ?id=... while cases are still loading
  if (selectedCaseId && activeTab === 'cases' && loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-16 text-center flex flex-col items-center shadow-xs max-w-xl mx-auto my-12">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
        <h3 className="text-sm font-bold text-slate-900">Loading Investigation Case</h3>
        <p className="text-xs text-slate-500 mt-1">Retrieving case files and incident history...</p>
      </div>
    )
  }

  // ==========================================================================
  // Render: Case Detail Workspace (when on Cases tab with active case)
  // ==========================================================================
  if (activeTab === 'cases' && selectedCase) {
    const inc = selectedCase.incident

    return (
      <div className="space-y-4 max-w-[1700px] mx-auto pb-12">
        
        {/* Top Header & Breadcrumb */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedCaseId(null)
                setSearchParams({ tab: 'cases' })
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <span>← Back to All Cases</span>
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-slate-500 uppercase">
                  #{selectedCase.id.slice(0, 8)}
                </span>
                <span className={cn("px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border", getPriorityBadgeStyle(selectedCase.priority))}>
                  {selectedCase.priority || 'Medium'} Priority
                </span>
              </div>
              <h1 className="text-xl font-bold text-slate-900 mt-0.5">{selectedCase.title}</h1>
            </div>
          </div>

          {/* Quick Lifecycle Status Actions */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-xs">
              {['New', 'Under Review', 'Investigating', 'Approved', 'Closed'].map((st) => (
                <button
                  key={st}
                  disabled={(st === 'Approved' || st === 'Closed') && !canApprove}
                  onClick={() => handleUpdateCaseStatus(st)}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                    selectedCase.status === st 
                      ? "bg-slate-900 text-white font-semibold shadow-xs" 
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  )}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Alerts / Error feedback */}
        {actionSuccessMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{actionSuccessMsg}</span>
            </div>
            <button onClick={() => setActionSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {actionError && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs font-medium flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button onClick={() => setActionError(null)} className="text-rose-700 hover:text-rose-900">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 3-Column Workspace Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          
          {/* Left Column: Metadata & Assignment (3 cols) */}
          <div className="lg:col-span-3 space-y-4">
            
            {/* Case File Overview Card */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
              <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider border-b border-slate-100 pb-2">
                Case Details
              </h3>
              
              <div className="space-y-2.5 text-xs">
                <div>
                  <span className="text-slate-400 block font-medium">Status</span>
                  <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold mt-0.5 border", getStatusBadgeStyle(selectedCase.status))}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" />
                    {selectedCase.status}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block font-medium">Priority</span>
                  <span className="font-bold text-slate-800">{selectedCase.priority || 'Medium'}</span>
                </div>

                <div>
                  <span className="text-slate-400 block font-medium">Opened On</span>
                  <span className="text-slate-700">{safeFormatDate(selectedCase.created_at, 'MMM d, yyyy h:mm a')}</span>
                  <span className="text-[10px] text-slate-400 block">{safeFormatDistance(selectedCase.created_at)}</span>
                </div>

                <div>
                  <span className="text-slate-400 block font-medium mb-1">Assigned Investigator</span>
                  <select
                    value={selectedCase.assigned_to || ''}
                    onChange={(e) => handleAssignInvestigator(e.target.value)}
                    className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-800 outline-none focus:ring-1 focus:ring-blue-500 font-medium cursor-pointer"
                  >
                    <option value="">Unassigned</option>
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.email} ({p.role || 'Staff'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Scope / Description Card */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-2">
              <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider border-b border-slate-100 pb-2">
                Investigation Scope
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                {selectedCase.description || 'No detailed scope recorded for this investigation.'}
              </p>
            </div>

          </div>

          {/* Middle Column: Primary & Linked Incidents & Evidence (6 cols) */}
          <div className="lg:col-span-6 space-y-4">
            
            {/* Associated Incidents Section */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-blue-500" />
                  <span>Linked Incidents ({associatedIncidentsList.length})</span>
                </h3>
                <button
                  onClick={() => setIsLinkIncidentModalOpen(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Link Incident</span>
                </button>
              </div>

              {associatedIncidentsList.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  No incidents linked to this investigation yet.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {associatedIncidentsList.map((item, idx) => {
                    const isPrimary = item.id === selectedCase.incident_id
                    const mediaTime = item.metadata?.media_time
                    const hasMediaTime = typeof mediaTime === 'number' && Number.isFinite(mediaTime)

                    return (
                      <div 
                        key={item.id}
                        className={cn(
                          "p-3 rounded-lg border text-xs transition-colors space-y-1.5",
                          isPrimary 
                            ? "bg-blue-50/40 border-blue-200" 
                            : "bg-slate-50 border-slate-200"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900">
                              #{item.id.slice(0, 8)}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-700">
                              {item.incident_type}
                            </span>
                            {isPrimary && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-blue-600 text-white">
                                Primary Origin
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400">
                            {safeFormatDate(item.created_at, 'MMM d, h:mm a')}
                          </span>
                        </div>

                        <p className="text-slate-600 text-[11px] leading-relaxed">
                          {item.description || 'Traffic event recorded by VisionGuard detection engine.'}
                        </p>

                        <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px]">
                          <span className="text-slate-500 truncate max-w-[200px]">
                            {item.video ? videoDisplayName(item.video, fallbackNumbers) : 'Video Footage'}
                          </span>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleOpenIncidentDetail(item.id)}
                              className="text-slate-600 hover:text-blue-600 font-semibold flex items-center gap-0.5 cursor-pointer"
                            >
                              <span>Incident Details</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>

                            {item.video_id && (
                              <Link
                                to={`/app/videos?video=${item.video_id}${hasMediaTime ? `&time=${mediaTime}` : ''}&incident=${item.id}`}
                                className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-0.5"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                <span>Review Video</span>
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Evidence Gallery Section */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-blue-500" />
                  <span>Case Evidence Exhibits ({caseEvidence.length})</span>
                </h3>
              </div>

              <div>
                {detailsLoading ? (
                  <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span>Loading evidence exhibits...</span>
                  </div>
                ) : caseEvidence.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    No image evidence exhibits linked directly to this case file.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {caseEvidence.map((ev) => {
                      const urls = caseEvidenceUrls[ev.id]
                      const imgUrl = urls?.thumb || urls?.full || ev.file_url

                      return (
                        <div
                          key={ev.id}
                          onClick={() => urls?.full && setEnlargedImageUrl(urls.full)}
                          className="group relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden cursor-pointer hover:border-blue-400 hover:shadow-xs transition-all"
                        >
                          {imgUrl ? (
                            <img
                              src={imgUrl}
                              alt="Case Evidence"
                              className="w-full h-28 object-cover group-hover:scale-105 transition-transform duration-200"
                            />
                          ) : (
                            <div className="w-full h-28 flex items-center justify-center text-slate-400">
                              <ImageIcon className="w-6 h-6" />
                            </div>
                          )}

                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <ZoomIn className="w-5 h-5 text-white" />
                          </div>

                          <div className="p-1.5 bg-white border-t border-slate-100 text-[10px] text-slate-600 flex items-center justify-between">
                            <span className="font-bold uppercase tracking-wider text-slate-700">
                              {ev.file_type || 'Snapshot'}
                            </span>
                            <span className="text-slate-400">
                              {ev.capture_timestamp ? safeFormatDate(ev.capture_timestamp, 'HH:mm:ss') : 'Recorded'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Investigation Notes & Timeline (3 cols) */}
          <div className="lg:col-span-3 space-y-4">
            
            {/* Notes Section */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col h-[340px]">
              <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200">
                <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                  <span>Investigation Notes ({caseNotes.length})</span>
                </h3>
              </div>

              <div className="p-3 flex-1 overflow-y-auto space-y-2.5 text-xs">
                {caseNotes.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic text-center py-4">No notes posted yet.</p>
                ) : (
                  caseNotes.map(n => (
                    <div key={n.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span className="font-bold text-slate-700">{n.author?.name || n.author?.email || 'Investigator'}</span>
                        <span>{safeFormatDistance(n.created_at)}</span>
                      </div>
                      <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{n.note}</p>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handlePostNote} className="p-2.5 bg-white border-t border-slate-200 flex gap-1.5">
                <input
                  type="text"
                  placeholder="Add note..."
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={isSubmittingNote || !newNote.trim()}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {isSubmittingNote ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Post'}
                </button>
              </form>
            </div>

            {/* Timeline Section */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col h-[280px]">
              <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200">
                <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Case Timeline ({caseTimeline.length})</span>
                </h3>
              </div>

              <div className="p-3 flex-1 overflow-y-auto space-y-2.5 text-xs">
                {caseTimeline.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic text-center py-4">No events logged.</p>
                ) : (
                  caseTimeline.map(ev => (
                    <div key={ev.id} className="border-l-2 border-slate-200 pl-2.5 py-0.5 space-y-0.5">
                      <p className="font-medium text-slate-800 text-[11px]">{ev.action}</p>
                      <div className="text-[10px] text-slate-400">
                        {safeFormatDate(ev.created_at, 'MMM d, h:mm a')} • {ev.actor?.name || 'System'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

        </div>

        {/* Modal: Link Incident */}
        {isLinkIncidentModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden">
              <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
                <h3 className="font-bold text-sm">Link Incident to Case</h3>
                <button onClick={() => setIsLinkIncidentModalOpen(false)} className="text-slate-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-3 text-xs">
                <label className="block font-bold text-slate-700 uppercase tracking-wider">
                  Select Incident to Link
                </label>
                <select
                  value={incidentToLink}
                  onChange={e => setIncidentToLink(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 outline-none"
                >
                  <option value="">Choose an incident...</option>
                  {allIncidents.filter(i => !associatedIncidentsList.some(a => a.id === i.id)).map(inc => (
                    <option key={inc.id} value={inc.id}>
                      #{inc.id.slice(0, 8)} — {inc.incident_type} ({inc.severity || 'Medium'}) • {safeFormatDate(inc.created_at, 'MMM d, h:mm a')}
                    </option>
                  ))}
                </select>
              </div>

              <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2 text-xs">
                <button
                  onClick={() => setIsLinkIncidentModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-200 rounded text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleLinkIncident}
                  disabled={!incidentToLink}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold disabled:opacity-50"
                >
                  Link Incident
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Fullscreen Evidence Lightbox */}
        {enlargedImageUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
            <div className="relative max-w-4xl max-h-[90vh] bg-slate-900 rounded-2xl overflow-hidden border border-slate-700 shadow-2xl flex flex-col">
              <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-white text-xs">
                <span className="font-bold">Case Evidence Exhibit</span>
                <button
                  onClick={() => setEnlargedImageUrl(null)}
                  className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-2 flex items-center justify-center overflow-auto max-h-[80vh]">
                <img
                  src={enlargedImageUrl}
                  alt="Enlarged Exhibit"
                  className="max-h-[75vh] w-auto object-contain rounded"
                />
              </div>
            </div>
          </div>
        )}

      </div>
    )
  }

  // ==========================================================================
  // Render: Main Consolidated Cases Workspace (Tabs: All Cases, All Incidents, Review Queue)
  // ==========================================================================
  return (
    <div className="space-y-5 max-w-[1700px] mx-auto pb-12">
      
      {/* Unified Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Case Management</h1>
            <span className={cn(
              "px-2.5 py-0.5 rounded-full text-xs font-semibold border",
              activeTab === 'cases' ? "bg-blue-50 text-blue-700 border-blue-200" :
              activeTab === 'review' ? "bg-amber-50 text-amber-700 border-amber-200" :
              "bg-indigo-50 text-indigo-700 border-indigo-200"
            )}>
              {activeTab === 'cases' ? 'Investigation Workspace' :
               activeTab === 'review' ? 'Verification Queue' : 'Incident Registry'}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {activeTab === 'cases' 
              ? 'Organize incidents, review evidence, and manage traffic investigations from one workspace.'
              : activeTab === 'review'
              ? 'Review and verify pending traffic infractions prioritized by severity before closing or escalating.'
              : 'Browse detected traffic events, inspect video evidence, and escalate infractions to formal cases.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchAllData}
            title="Refresh Workspace Data"
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Case</span>
          </button>
        </div>
      </div>

      {/* Primary Workspace Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-px">
        <button
          onClick={() => handleSwitchTab('cases')}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer",
            activeTab === 'cases'
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <FolderOpen className="w-4 h-4" />
          <span>All Cases</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
            {cases.length}
          </span>
        </button>

        <button
          onClick={() => handleSwitchTab('incidents')}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer",
            activeTab === 'incidents'
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>All Incidents</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
            {allIncidents.length}
          </span>
        </button>

        <button
          onClick={() => handleSwitchTab('review')}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-colors cursor-pointer",
            activeTab === 'review'
              ? "border-amber-600 text-amber-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <Clock className="w-4 h-4" />
          <span>Review Queue</span>
          {pendingIncidentsCount > 0 ? (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
              {pendingIncidentsCount} Pending
            </span>
          ) : (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
              0 Pending
            </span>
          )}
        </button>
      </div>

      {/* Global Notifications */}
      {actionSuccessMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
          <button onClick={() => setActionSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {(loadError || actionError) && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{loadError || actionError}</span>
          </div>
          <button onClick={() => { setLoadError(null); setActionError(null); }} className="text-rose-700 hover:text-rose-900 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 1: ALL CASES                                                     */}
      {/* ==================================================================== */}
      {activeTab === 'cases' && (
        <div className="space-y-5">
          
          {/* Missing Case Inaccessible Alert */}
          {selectedCaseId && !selectedCase && !loading && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-amber-900 font-medium">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Case file #{selectedCaseId.slice(0, 8)} was not found or is inaccessible.</span>
              </div>
              <button
                onClick={() => {
                  setSelectedCaseId(null)
                  setSearchParams({ tab: 'cases' })
                }}
                className="px-3 py-1.5 bg-white border border-amber-300 rounded text-amber-800 hover:bg-amber-100 font-semibold cursor-pointer shadow-xs"
              >
                View All Cases
              </button>
            </div>
          )}

          {/* Top Operational Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Total Cases</span>
              <div className="text-2xl font-bold text-slate-900 mt-1">{overviewMetrics.total}</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Active Investigations</span>
              <div className="text-2xl font-bold text-blue-600 mt-1">{overviewMetrics.active}</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Urgent Priority</span>
              <div className="text-2xl font-bold text-rose-600 mt-1">{overviewMetrics.urgent}</div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Resolved / Closed</span>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{overviewMetrics.closed}</div>
            </div>
          </div>

          {/* Search & Filter Toolbar for Cases */}
          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[260px]">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search cases by title, ID, event type, investigator..."
                  value={caseSearchQuery}
                  onChange={e => setCaseSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Status Filter */}
              <select
                value={caseStatusFilter}
                onChange={e => setCaseStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer"
              >
                <option value="All">All Statuses</option>
                <option value="New">New</option>
                <option value="Under Review">Under Review</option>
                <option value="Investigating">Investigating</option>
                <option value="Escalated">Escalated</option>
                <option value="Approved">Approved</option>
                <option value="Closed">Closed</option>
              </select>

              {/* Priority Filter */}
              <select
                value={casePriorityFilter}
                onChange={e => setCasePriorityFilter(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer"
              >
                <option value="All">All Priorities</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>

              {/* Date Filter */}
              <select
                value={caseDateFilter}
                onChange={e => setCaseDateFilter(e.target.value as DateFilter)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer"
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
              </select>

              {(caseSearchQuery || caseStatusFilter !== 'All' || casePriorityFilter !== 'All' || caseDateFilter !== 'all') && (
                <button
                  onClick={() => {
                    setCaseSearchQuery('')
                    setCaseStatusFilter('All')
                    setCasePriorityFilter('All')
                    setCaseDateFilter('all')
                  }}
                  className="px-2.5 py-1.5 text-xs text-blue-600 hover:underline cursor-pointer"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Cases Master List */}
          {loading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-16 text-center flex flex-col items-center shadow-xs">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
              <h3 className="text-sm font-bold text-slate-900">Loading Cases</h3>
              <p className="text-xs text-slate-500 mt-1">Retrieving investigation files...</p>
            </div>
          ) : filteredCases.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-16 text-center flex flex-col items-center shadow-xs">
              <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                <FolderOpen className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">No Cases Found</h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">
                {cases.length === 0 
                  ? 'No investigation cases have been opened yet. You can create a case or escalate any incident from the All Incidents or Review Queue tabs.'
                  : 'No cases match your active filters.'}
              </p>
              {cases.length === 0 ? (
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs"
                >
                  Open First Case
                </button>
              ) : (
                <button
                  onClick={() => {
                    setCaseSearchQuery('')
                    setCaseStatusFilter('All')
                    setCasePriorityFilter('All')
                    setCaseDateFilter('all')
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
                >
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCases.map(c => {
                const inc = c.incident
                const addCount = c.additional_incident_ids?.length || 0

                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      setSelectedCaseId(c.id)
                      setSearchParams({ tab: 'cases', id: c.id })
                    }}
                    className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between group"
                  >
                    <div>
                      {/* Card Header */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] font-bold text-slate-500">
                            #{c.id.slice(0, 8)}
                          </span>
                          <span className={cn("px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider border", getPriorityBadgeStyle(c.priority))}>
                            {c.priority || 'Medium'}
                          </span>
                        </div>

                        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border", getStatusBadgeStyle(c.status))}>
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {c.status}
                        </span>
                      </div>

                      {/* Title */}
                      <h3 className="font-bold text-sm text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-1">
                        {c.title}
                      </h3>

                      {/* Origin incident info */}
                      {inc ? (
                        <div className="mt-2.5 p-2 bg-slate-50 rounded-lg text-xs text-slate-600 space-y-1">
                          <div className="flex items-center justify-between font-medium">
                            <span className="text-slate-800 uppercase tracking-wider text-[10px] font-bold">
                              {inc.incident_type || 'Event'}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {safeFormatDate(inc.created_at, 'MMM d, h:mm a')}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 line-clamp-1">
                            {inc.description || 'VisionGuard detected traffic infraction.'}
                          </p>
                        </div>
                      ) : (
                        <div className="mt-2.5 p-2 bg-slate-50/60 rounded-lg text-[11px] text-slate-400 italic">
                          Manual traffic inquiry record
                        </div>
                      )}

                      {addCount > 0 && (
                        <div className="mt-2 text-[10px] text-indigo-600 font-semibold flex items-center gap-1">
                          <ShieldAlert className="w-3 h-3" />
                          <span>+ {addCount} additional linked infraction{addCount > 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </div>

                    {/* Card Footer */}
                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                      <div className="flex items-center gap-1.5 truncate max-w-[180px]">
                        <User className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate text-slate-600">
                          {c.assignee?.name || c.assignee?.email || 'Unassigned'}
                        </span>
                      </div>
                      <span className="text-[11px] shrink-0">
                        {safeFormatDistance(c.created_at)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2 & 3: ALL INCIDENTS & REVIEW QUEUE WORKSPACE                    */}
      {/* ==================================================================== */}
      {(activeTab === 'incidents' || activeTab === 'review') && (
        <div className="space-y-4">
          
          {/* Review Queue Operator Callout Banner */}
          {isReviewTab && (
            <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-900 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <span className="font-bold text-amber-950">Operator Verification Queue</span>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Review pending traffic infractions prioritized by severity. Confirm detections, dismiss false positives, or escalate to formal investigation cases.
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="font-bold text-amber-950 text-base">{filteredIncidents.length}</span>
                <span className="text-[11px] text-amber-700 block">requiring operator review</span>
              </div>
            </div>
          )}

          {/* Search & Filter Toolbar for Incidents */}
          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs space-y-3">
            <div className="flex items-center gap-2.5">
              {/* Search Box */}
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by ID, type, description, vehicle track, video filename..."
                  value={incSearchQuery}
                  onChange={e => setIncSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Toggle Filter Panel Button */}
              <button
                onClick={() => setIsIncFilterPanelOpen(prev => !prev)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer shrink-0",
                  isIncFilterPanelOpen || (activeIncFilterCount > (incSearchQuery.trim() ? 1 : 0))
                    ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                    : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                )}
              >
                <Filter className="w-3.5 h-3.5" />
                <span>Filters</span>
                {activeIncFilterCount > (incSearchQuery.trim() ? 1 : 0) && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-blue-600 text-white text-[10px] font-bold leading-tight">
                    {activeIncFilterCount - (incSearchQuery.trim() ? 1 : 0)}
                  </span>
                )}
              </button>
            </div>

            {/* Expandable Filter Panel */}
            {isIncFilterPanelOpen && (
              <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
                {/* Severity Filter */}
                <select
                  value={incSeverityFilter}
                  onChange={e => setIncSeverityFilter(e.target.value as SeverityFilter)}
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
                  value={incTypeFilter}
                  onChange={e => setIncTypeFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer"
                >
                  <option value="all">All Event Types</option>
                  {uniqueIncidentTypes.map(t => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ').toUpperCase()}
                    </option>
                  ))}
                </select>

                {/* Status Filter (only if on All Incidents tab) */}
                {!isReviewTab && (
                  <select
                    value={incStatusFilter}
                    onChange={e => setIncStatusFilter(e.target.value as IncidentStatusFilter)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer"
                  >
                    <option value="all">All Review Statuses</option>
                    <option value="active">Active (Unresolved)</option>
                    <option value="resolved">Resolved</option>
                    <option value="rejected">Rejected (False Positive)</option>
                  </select>
                )}

                {/* Date Filter */}
                <select
                  value={incDateFilter}
                  onChange={e => setIncDateFilter(e.target.value as DateFilter)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer"
                >
                  <option value="all">All Time</option>
                  <option value="today">Today</option>
                  <option value="7d">Last 7 Days</option>
                  <option value="30d">Last 30 Days</option>
                </select>

                {/* Video Scope Filter */}
                <select
                  value={incVideoFilter}
                  onChange={e => setIncVideoFilter(e.target.value)}
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
                {activeIncFilterCount > 0 && (
                  <button
                    onClick={handleResetIncFilters}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors ml-auto"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Reset Filters</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Master Incident List + Incident Detail Panel */}
          {loading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-16 text-center flex flex-col items-center shadow-xs">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
              <h3 className="text-sm font-bold text-slate-900">Loading Incidents</h3>
              <p className="text-xs text-slate-500 mt-1">Retrieving infractions and evidence records...</p>
            </div>
          ) : allIncidents.length === 0 ? (
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
                        onClick={handleResetIncFilters}
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
                                    <button
                                      onClick={e => {
                                        e.stopPropagation()
                                        handleOpenLinkedCase(linkedCase.id)
                                      }}
                                      title={linkedCase.title || `Investigation #${(linkedCase.id || '').slice(0, 8)}`}
                                      className="text-indigo-600 hover:text-indigo-800"
                                    >
                                      <FolderOpen className="w-3.5 h-3.5" />
                                    </button>
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

              {/* Incident Detail / Inspector Panel */}
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

                    {/* Description & Notes */}
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
                            <button
                              onClick={() => handleOpenLinkedCase(linkedCase.id)}
                              className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
                            >
                              <span>Open Case</span>
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="p-3 bg-indigo-50/60 border border-indigo-200 rounded-lg flex items-center justify-between">
                            <div>
                              <span className="text-[10px] uppercase font-bold text-indigo-700 block">Investigation</span>
                              <span className="text-xs text-indigo-950 font-medium block mt-0.5">
                                No case opened for this incident yet.
                              </span>
                            </div>
                            <button
                              onClick={() => handleEscalateIncidentToCase(selectedIncident)}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-semibold shadow-xs cursor-pointer"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                              <span>Create Case</span>
                            </button>
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
                          onClick={() => handleUpdateIncidentStatus('Resolved')}
                          disabled={isUpdatingIncidentStatus || selectedIncident.status === 'Resolved'}
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
                          onClick={() => handleUpdateIncidentStatus('Active')}
                          disabled={isUpdatingIncidentStatus || selectedIncident.status === 'Active'}
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
                          onClick={() => handleUpdateIncidentStatus('Rejected')}
                          disabled={isUpdatingIncidentStatus || selectedIncident.status === 'Rejected'}
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
                          value={incidentReviewNotes}
                          onChange={e => setIncidentReviewNotes(e.target.value)}
                          placeholder="Add investigation remarks or resolution context..."
                          className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                        />
                        <div className="flex justify-end">
                          <button
                            onClick={handleSaveIncidentNotes}
                            disabled={isSavingIncidentNotes}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50"
                          >
                            {isSavingIncidentNotes ? 'Saving...' : 'Save Notes'}
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
      )}

      {/* ==================================================================== */}
      {/* MODAL: CREATE CASE                                                   */}
      {/* ==================================================================== */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">Create Investigation Case</h3>
                <p className="text-xs text-slate-400 mt-0.5">Formalize incident records into a collaborative investigation case.</p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCase} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Case Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Red Light Infraction Investigation — Sector 4"
                  value={createTitle}
                  onChange={e => setCreateTitle(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 font-medium outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Priority Level
                  </label>
                  <select
                    value={createPriority}
                    onChange={e => setCreatePriority(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium outline-none"
                  >
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Initial Status
                  </label>
                  <select
                    value={createInitialStatus}
                    onChange={e => setCreateInitialStatus(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium outline-none"
                  >
                    <option value="New">New</option>
                    <option value="Under Review">Under Review</option>
                    <option value="Investigating">Investigating</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Primary Incident Record
                </label>
                <select
                  value={createPrimaryIncidentId}
                  onChange={e => setCreatePrimaryIncidentId(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium outline-none"
                >
                  <option value="">No primary incident (Manual Case)</option>
                  {allIncidents.map(inc => (
                    <option key={inc.id} value={inc.id}>
                      #{inc.id.slice(0, 8)} — {inc.incident_type} ({inc.severity || 'Medium'}) • {safeFormatDate(inc.created_at, 'MMM d, h:mm a')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Additional Incidents (Multi-Select)
                </label>
                <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1 bg-slate-50">
                  {allIncidents.filter(i => i.id !== createPrimaryIncidentId).map(inc => {
                    const isChecked = createAdditionalIncidents.includes(inc.id)
                    return (
                      <label key={inc.id} className="flex items-center gap-2 text-slate-700 hover:bg-slate-100 p-1 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              setCreateAdditionalIncidents(prev => [...prev, inc.id])
                            } else {
                              setCreateAdditionalIncidents(prev => prev.filter(id => id !== inc.id))
                            }
                          }}
                          className="rounded text-blue-600"
                        />
                        <span className="font-mono font-bold text-[11px]">#{inc.id.slice(0, 8)}</span>
                        <span className="truncate">{inc.incident_type} ({inc.severity || 'Medium'})</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Assign Lead Investigator
                </label>
                <select
                  value={createAssigneeId}
                  onChange={e => setCreateAssigneeId(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium outline-none"
                >
                  <option value="">Unassigned</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name || p.email} ({p.role || 'Staff'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Investigation Description / Scope
                </label>
                <textarea
                  rows={3}
                  placeholder="Summarize key facts, suspected traffic violations, and next investigative steps..."
                  value={createDescription}
                  onChange={e => setCreateDescription(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 font-medium outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingCase || !createTitle.trim()}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isCreatingCase ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  <span>{isCreatingCase ? 'Creating...' : 'Create Case'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Fullscreen Evidence Lightbox (Shared) */}
      {enlargedImageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="relative max-w-4xl max-h-[90vh] bg-slate-900 rounded-2xl overflow-hidden border border-slate-700 shadow-2xl flex flex-col">
            <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-white text-xs">
              <span className="font-bold">Evidence Exhibit</span>
              <button
                onClick={() => setEnlargedImageUrl(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-2 flex items-center justify-center overflow-auto max-h-[80vh]">
              <img
                src={enlargedImageUrl}
                alt="Enlarged Exhibit"
                className="max-h-[75vh] w-auto object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default Cases
