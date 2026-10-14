import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { 
  FolderSearch, FolderOpen, MapPin, Clock, Shield, ShieldAlert,
  Image as ImageIcon, Video as VideoIcon, MessageSquare, Plus, 
  FileSignature, Loader2, Play, AlertTriangle, AlertOctagon, 
  CheckCircle2, X, ChevronRight, User, Eye, ArrowUpRight, 
  RefreshCw, Check, XCircle, Filter, Search, Camera, ZoomIn
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

export interface IncidentOption {
  id: string
  incident_type: string
  severity: string | null
  status: string | null
  created_at: string
  video_id: string | null
  track_id: number | null
  description: string | null
  metadata: Record<string, any> | null
  video?: VideoAsset | null
}

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

  // Data states
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [allIncidents, setAllIncidents] = useState<IncidentOption[]>([])
  const [videos, setVideos] = useState<VideoAsset[]>([])
  const [profiles, setProfiles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null)

  // Filtering states
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7d' | '30d'>('all')

  // Selected Case (Detail View)
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(
    searchParams.get('id') || null
  )
  const selectedCase = useMemo(() => {
    return cases.find(c => c.id === selectedCaseId) || null
  }, [cases, selectedCaseId])

  // Case Details State (Evidence, Notes, Timeline)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [caseEvidence, setCaseEvidence] = useState<any[]>([])
  const [caseEvidenceUrls, setCaseEvidenceUrls] = useState<Record<string, { full: string; thumb: string }>>({})
  const [caseNotes, setCaseNotes] = useState<any[]>([])
  const [caseTimeline, setCaseTimeline] = useState<any[]>([])
  const [enlargedImageUrl, setEnlargedImageUrl] = useState<string | null>(null)

  // Note posting state
  const [newNote, setNewNote] = useState('')
  const [isSubmittingNote, setIsSubmittingNote] = useState(false)

  // Create Case Modal state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isCreatingCase, setIsCreatingCase] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createPriority, setCreatePriority] = useState('Medium')
  const [createInitialStatus, setCreateInitialStatus] = useState('New')
  const [createPrimaryIncidentId, setCreatePrimaryIncidentId] = useState<string>('')
  const [createAdditionalIncidents, setCreateAdditionalIncidents] = useState<string[]>([])
  const [createAssigneeId, setCreateAssigneeId] = useState<string>('')
  const [createDescription, setCreateDescription] = useState('')

  // Link Incident Modal (from inside case detail view)
  const [isLinkIncidentModalOpen, setIsLinkIncidentModalOpen] = useState(false)
  const [incidentToLink, setIncidentToLink] = useState('')

  const fallbackNumbers = useMemo(() => fallbackVideoNumbers(videos), [videos])
  const canApprove = role === 'Supervisor' || role === 'Admin'

  // --------------------------------------------------------------------------
  // Data Fetching
  // --------------------------------------------------------------------------
  const fetchAllData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)

    try {
      let rawCases: any[] = []
      const [casesRes, incRes, vidRes, profRes] = await Promise.all([
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
        supabase.from('profiles').select('id, name, email, role')
      ])

      if (casesRes.error) {
        console.warn('Direct cases join error, falling back to basic query:', casesRes.error)
        const fallbackRes = await supabase.from('cases').select('*').order('created_at', { ascending: false })
        if (fallbackRes.error) throw fallbackRes.error
        rawCases = fallbackRes.data || []
      } else {
        rawCases = casesRes.data || []
      }

      const fetchedVideos = (vidRes.data || []) as VideoAsset[]
      const vidMap = new Map<string, VideoAsset>()
      fetchedVideos.forEach(v => vidMap.set(v.id, v))
      setVideos(fetchedVideos)

      const fetchedIncidents = ((incRes.data || []) as any[]).map(inc => ({
        ...inc,
        video: inc.video_id ? vidMap.get(inc.video_id) || null : null
      }))
      setAllIncidents(fetchedIncidents)

      const incMap = new Map<string, any>()
      fetchedIncidents.forEach(i => incMap.set(i.id, i))

      const profMap = new Map<string, any>()
      if (profRes.data) {
        profRes.data.forEach((p: any) => profMap.set(p.id, p))
        setProfiles(profRes.data)
      }

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
      console.error('Failed to load cases:', err)
      setLoadError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAllData()
  }, [fetchAllData])

  // Synchronize URL search params with state
  useEffect(() => {
    const paramId = searchParams.get('id')
    setSelectedCaseId(paramId || null)

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
        supabase.from('incidents').select('*, cameras(name)').eq('id', createIncidentId).maybeSingle().then(({ data }) => {
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
  }, [cases])

  useEffect(() => {
    if (selectedCaseId) {
      const c = cases.find(item => item.id === selectedCaseId)
      fetchCaseSubDetails(selectedCaseId, c?.incident_id)
    }
  }, [selectedCaseId, fetchCaseSubDetails, cases])

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

      // Refresh and open the new case
      await fetchAllData()
      setSelectedCaseId(newCaseId)
      setSearchParams({ id: newCaseId })
      setTimeout(() => setActionSuccessMsg(null), 4000)
    } catch (err: any) {
      console.error('Case creation failed:', err)
      setActionError(`Case creation failed: ${err.message || String(err)}`)
    } finally {
      setIsCreatingCase(false)
    }
  }

  // --------------------------------------------------------------------------
  // Case Lifecycle Status Transitions & Assignment
  // --------------------------------------------------------------------------
  const handleUpdateStatus = async (newStatus: string) => {
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

  // --------------------------------------------------------------------------
  // Investigation Notes Posting
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Link Additional Incident to Case
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // List Filtering
  // --------------------------------------------------------------------------
  const filteredCases = useMemo(() => {
    const now = new Date()
    let dateCutoff: Date | null = null
    if (dateFilter === 'today') dateCutoff = startOfDay(now)
    else if (dateFilter === '7d') dateCutoff = subDays(now, 7)
    else if (dateFilter === '30d') dateCutoff = subDays(now, 30)

    const q = searchQuery.trim().toLowerCase()

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
      if (statusFilter !== 'All' && c.status !== statusFilter) return false

      // 3. Priority
      if (priorityFilter !== 'All' && c.priority !== priorityFilter) return false

      // 4. Date
      if (dateCutoff && new Date(c.created_at) < dateCutoff) return false

      return true
    })
  }, [cases, searchQuery, statusFilter, priorityFilter, dateFilter])

  // Overview Metrics
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

  // Handle direct navigation to ?id=... while cases are still loading
  if (selectedCaseId && loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-16 text-center flex flex-col items-center shadow-xs max-w-xl mx-auto my-12">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
        <h3 className="text-sm font-bold text-slate-900">Loading Investigation Case</h3>
        <p className="text-xs text-slate-500 mt-1">Retrieving case files and incident history...</p>
      </div>
    )
  }

  // ==========================================================================
  // Render: Case Detail Workspace
  // ==========================================================================
  if (selectedCase) {
    const inc = selectedCase.incident

    return (
      <div className="space-y-4 max-w-[1700px] mx-auto pb-12">
        
        {/* Top Header & Breadcrumb */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedCaseId(null)
                setSearchParams({})
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <span>← Back to Cases</span>
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

          {/* Status & Lifecycle Action Controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status:</span>
              <select
                value={selectedCase.status}
                onChange={e => handleUpdateStatus(e.target.value)}
                disabled={role === 'Viewer'}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border outline-none cursor-pointer disabled:opacity-50 shadow-xs",
                  getStatusBadgeStyle(selectedCase.status)
                )}
              >
                <option value="New">New</option>
                <option value="Under Review">Under Review</option>
                <option value="Investigating">Investigating</option>
                <option value="Escalated">Escalated</option>
                <option value="Approved">Approved</option>
                <option value="Closed">Closed</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Assignee:</span>
              <select
                value={selectedCase.assigned_to || ''}
                onChange={e => handleAssignInvestigator(e.target.value)}
                disabled={role === 'Viewer'}
                className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none cursor-pointer shadow-xs disabled:opacity-50"
              >
                <option value="">Unassigned</option>
                {profiles.filter(p => p.role !== 'Viewer').map(p => (
                  <option key={p.id} value={p.id}>{p.name || p.email}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Feedback Banners */}
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

        {/* Investigation Workspace 3-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          
          {/* Left Column: Overview & Associated Incidents (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            
            {/* Investigation Scope Card */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
              <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                Investigation Overview
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                {selectedCase.description || 'Investigation initiated on traffic incidents and infractions.'}
              </p>
              <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-100 text-[11px]">
                <div>
                  <span className="text-slate-400 block font-medium">Opened</span>
                  <span className="font-bold text-slate-800 block mt-0.5">
                    {safeFormatDate(selectedCase.created_at, 'MMM d, yyyy h:mm a')}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Last Updated</span>
                  <span className="font-bold text-slate-800 block mt-0.5">
                    {safeFormatDistance(selectedCase.updated_at || selectedCase.created_at)}
                  </span>
                </div>
              </div>
            </div>

            {/* Associated Incidents Card */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
              <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                    Associated Incidents ({associatedIncidentsList.length})
                  </h3>
                  <span className="text-[11px] text-slate-400">Linked to this investigation</span>
                </div>
                <button
                  onClick={() => setIsLinkIncidentModalOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded text-xs font-semibold cursor-pointer shadow-xs transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Link Incident</span>
                </button>
              </div>

              <div className="p-3 space-y-2.5 max-h-[480px] overflow-y-auto">
                {associatedIncidentsList.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    No incidents currently linked to this case. Use "+ Link Incident" to attach evidence.
                  </div>
                ) : (
                  associatedIncidentsList.map(item => {
                    const mediaTime = item.metadata?.media_time
                    const hasMediaTime = typeof mediaTime === 'number' && Number.isFinite(mediaTime)

                    return (
                      <div
                        key={item.id}
                        className="p-3 bg-slate-50/60 border border-slate-200 rounded-lg hover:border-blue-300 transition-all space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900">#{item.id.slice(0, 8)}</span>
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                              item.severity === 'Critical' ? "bg-rose-100 text-rose-800" :
                              item.severity === 'High' ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                            )}>
                              {item.severity || 'Medium'}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400">
                            {safeFormatDate(item.created_at, 'MMM d, h:mm a')}
                          </span>
                        </div>

                        <div>
                          <span className="font-bold text-slate-800">
                            {String(item.incident_type || 'Event').replace(/_/g, ' ').toUpperCase()}
                          </span>
                          {item.track_id !== null && (
                            <span className="text-slate-500 font-mono text-[11px] ml-1.5">Track #{item.track_id}</span>
                          )}
                          <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                            {item.description || 'Registered traffic anomaly'}
                          </p>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 text-[11px]">
                          <span className="text-slate-500 truncate max-w-[180px]">
                            {item.video ? videoDisplayName(item.video, fallbackNumbers) : 'Video Footage'}
                          </span>

                          <div className="flex items-center gap-2">
                            <Link
                              to={`/app/incidents?id=${item.id}`}
                              className="text-slate-600 hover:text-blue-600 font-semibold flex items-center gap-0.5"
                            >
                              <span>Incident Details</span>
                              <ExternalLink className="w-3 h-3" />
                            </Link>

                            {item.video_id && (
                              <Link
                                to={`/app/videos?video=${item.video_id}${hasMediaTime ? `&time=${mediaTime}` : ''}&incident=${item.id}`}
                                className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-0.5"
                              >
                                <span>Replay</span>
                                <Play className="w-3 h-3 fill-current" />
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

          </div>

          {/* Center Column: Evidence Exhibits (4 cols) */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col h-full min-h-[500px]">
              <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                    Evidence Exhibits ({caseEvidence.length})
                  </h3>
                  <span className="text-[11px] text-slate-400">Photographic & video exhibits</span>
                </div>
                {detailsLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />}
              </div>

              <div className="p-4 flex-1 overflow-y-auto space-y-3">
                {caseEvidence.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400 flex flex-col items-center">
                    <Camera className="w-8 h-8 text-slate-300 mb-2" />
                    <p className="font-medium text-slate-600">No photo evidence attached to this case.</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Visual evidence captured during AI analysis will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    {caseEvidence.map(ev => {
                      const urls = caseEvidenceUrls[ev.id]
                      const thumb = urls?.thumb || urls?.full || ''
                      const full = urls?.full || ''

                      return (
                        <div
                          key={ev.id}
                          onClick={() => full && setEnlargedImageUrl(full)}
                          className="group relative bg-slate-100 border border-slate-200 rounded-lg overflow-hidden cursor-pointer hover:border-blue-400 transition-all shadow-xs"
                        >
                          {thumb ? (
                            <img
                              src={thumb}
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
  // Render: Cases List View
  // ==========================================================================
  return (
    <div className="space-y-5 max-w-[1700px] mx-auto pb-12">
      
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Case Management</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              Investigation Workspace
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Organize incidents, review evidence, and manage traffic investigations from one workspace.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/app/incidents"
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-blue-500" />
            <span>Incident Center</span>
          </Link>
          <Link
            to="/app/incidents?tab=review"
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            <span>Review Queue</span>
          </Link>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Case</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
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

      {loadError && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button onClick={() => setLoadError(null)} className="text-rose-700 hover:text-rose-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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
              setSearchParams({})
            }}
            className="px-3 py-1.5 bg-white border border-amber-300 rounded text-amber-800 hover:bg-amber-100 font-semibold cursor-pointer shadow-xs"
          >
            View All Cases
          </button>
        </div>
      )}

      {/* Top Operational Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Total Cases</span>
            <FolderOpen className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-1.5">{overviewMetrics.total}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Investigation files</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Active Investigations</span>
            <Clock className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-bold text-purple-600 mt-1.5">{overviewMetrics.active}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">In progress / review</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Urgent Priority</span>
            <AlertOctagon className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold text-rose-600 mt-1.5">{overviewMetrics.urgent}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Critical or High priority</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>Resolved & Closed</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-emerald-600 mt-1.5">{overviewMetrics.closed}</div>
          <p className="text-[11px] text-slate-400 mt-0.5">Approved or closed</p>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by case title, ID, incident type, or investigator..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={() => setIsFilterPanelOpen(prev => !prev)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer shrink-0",
              isFilterPanelOpen || (statusFilter !== 'All' || priorityFilter !== 'All' || dateFilter !== 'all')
                ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filters</span>
            {((statusFilter !== 'All' ? 1 : 0) + (priorityFilter !== 'All' ? 1 : 0) + (dateFilter !== 'all' ? 1 : 0)) > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-blue-600 text-white text-[10px] font-bold leading-tight">
                {(statusFilter !== 'All' ? 1 : 0) + (priorityFilter !== 'All' ? 1 : 0) + (dateFilter !== 'all' ? 1 : 0)}
              </span>
            )}
          </button>
        </div>

        {/* Expandable Filter Panel */}
        {isFilterPanelOpen && (
          <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
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

            <select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer"
            >
              <option value="All">All Priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>

            <select
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value as any)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none cursor-pointer"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>

            {(statusFilter !== 'All' || priorityFilter !== 'All' || dateFilter !== 'all') && (
              <button
                onClick={() => {
                  setStatusFilter('All')
                  setPriorityFilter('All')
                  setDateFilter('all')
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors ml-auto"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reset Filters</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Cases Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-16 text-center flex flex-col items-center">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-3" />
            <p className="text-xs text-slate-500">Loading investigation cases from database...</p>
          </div>
        ) : filteredCases.length === 0 ? (
          <div className="p-16 text-center flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
              <FolderOpen className="w-6 h-6 text-slate-400" />
            </div>
            <h3 className="text-base font-bold text-slate-900">No Cases Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">
              {cases.length === 0
                ? 'No investigation cases have been opened yet. Create your first case or open one from the Incident Center.'
                : 'No cases match your active filter criteria.'}
            </p>
            {cases.length === 0 ? (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
              >
                Create First Case
              </button>
            ) : (
              <button
                onClick={() => {
                  setSearchQuery('')
                  setStatusFilter('All')
                  setPriorityFilter('All')
                  setDateFilter('all')
                }}
                className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto w-full min-w-0">
            <table className="w-full min-w-[700px] text-left border-collapse text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3 font-bold text-slate-500 uppercase tracking-wider">Case Title & ID</th>
                  <th className="px-5 py-3 font-bold text-slate-500 uppercase tracking-wider">Priority</th>
                  <th className="px-5 py-3 font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 font-bold text-slate-500 uppercase tracking-wider">Primary Event</th>
                  <th className="px-5 py-3 font-bold text-slate-500 uppercase tracking-wider">Investigator</th>
                  <th className="px-5 py-3 font-bold text-slate-500 uppercase tracking-wider">Created</th>
                  <th className="px-5 py-3 font-bold text-slate-500 uppercase tracking-wider text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCases.map(c => {
                  const inc = c.incident
                  return (
                    <tr
                      key={c.id}
                      onClick={() => {
                        setSelectedCaseId(c.id)
                        setSearchParams({ id: c.id })
                      }}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    >
                      <td className="px-5 py-3.5">
                        <div className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                          {c.title}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400 mt-0.5">
                          #{c.id.slice(0, 8)}
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        <span className={cn("px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border", getPriorityBadgeStyle(c.priority))}>
                          {c.priority || 'Medium'}
                        </span>
                      </td>

                      <td className="px-5 py-3.5">
                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border", getStatusBadgeStyle(c.status))}>
                          {c.status}
                        </span>
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="font-medium text-slate-800">
                          {inc ? String(inc.incident_type || 'Event').replace(/_/g, ' ') : 'General Investigation'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {inc?.camera?.name || (inc?.video ? videoDisplayName(inc.video, fallbackNumbers) : 'Video Footage')}
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        {c.assignee ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center justify-center uppercase">
                              {c.assignee.name?.charAt(0) || 'U'}
                            </div>
                            <span className="text-slate-800 font-medium">{c.assignee.name || c.assignee.email}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Unassigned</span>
                        )}
                      </td>

                      <td className="px-5 py-3.5 text-slate-500">
                        <div>{safeFormatDate(c.created_at, 'MMM d, yyyy')}</div>
                        <div className="text-[10px] text-slate-400">
                          {safeFormatDistance(c.created_at)}
                        </div>
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedCaseId(c.id)
                            setSearchParams({ id: c.id })
                          }}
                          className="text-blue-600 font-semibold text-xs group-hover:translate-x-1 transition-transform inline-flex items-center gap-1 cursor-pointer"
                        >
                          <span>Inspect</span>
                          <ChevronRight className="w-3.5 h-3.5" />
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

      {/* ==================================================================== */}
      {/* Modal: Create Investigation Case */}
      {/* ==================================================================== */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden my-8">
            
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">Create Investigation Case</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Organize traffic incidents, evidence exhibits, and investigation remarks.
                </p>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCase} className="p-6 space-y-4 text-xs">
              
              {/* Title */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-1">
                  Case Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Reckless Driving & Speeding Corridor Investigation"
                  value={createTitle}
                  onChange={e => setCreateTitle(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Priority & Status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-1">
                    Priority
                  </label>
                  <select
                    value={createPriority}
                    onChange={e => setCreatePriority(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 outline-none"
                  >
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-1">
                    Initial Status
                  </label>
                  <select
                    value={createInitialStatus}
                    onChange={e => setCreateInitialStatus(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 outline-none"
                  >
                    <option value="New">New</option>
                    <option value="Under Review">Under Review</option>
                    <option value="Investigating">Investigating</option>
                  </select>
                </div>
              </div>

              {/* Primary Incident */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-1">
                  Primary Incident
                </label>
                <select
                  value={createPrimaryIncidentId}
                  onChange={e => setCreatePrimaryIncidentId(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 outline-none"
                >
                  <option value="">No primary incident (General case)</option>
                  {allIncidents.map(inc => (
                    <option key={inc.id} value={inc.id}>
                      #{inc.id.slice(0, 8)} — {inc.incident_type} ({inc.severity || 'Medium'}) • {safeFormatDate(inc.created_at, 'MMM d, h:mm a')}
                    </option>
                  ))}
                </select>
              </div>

              {/* Assigned Investigator */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-1">
                  Assigned Investigator
                </label>
                <select
                  value={createAssigneeId}
                  onChange={e => setCreateAssigneeId(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 outline-none"
                >
                  <option value="">Unassigned</option>
                  {profiles.filter(p => p.role !== 'Viewer').map(p => (
                    <option key={p.id} value={p.id}>{p.name || p.email} ({p.role})</option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-1">
                  Investigation Summary
                </label>
                <textarea
                  rows={3}
                  placeholder="Summarize the nature of the violation, camera corridor, or suspects..."
                  value={createDescription}
                  onChange={e => setCreateDescription(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingCase}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  {isCreatingCase && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create Case</span>
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  )
}

export default Cases
