import { useState, useEffect, useRef, useCallback } from 'react'
import { 
  FolderSearch, FolderOpen, MapPin, 
  Clock, Shield, Image as ImageIcon, Video as VideoIcon,
  MessageSquare, Plus, FileSignature, Loader2
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { formatDistanceToNow } from 'date-fns'

export function Cases() {
  const { user, role } = useAuthStore()
  const [cases, setCases] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  
  // Case Details State
  const [selectedCase, setSelectedCase] = useState<any | null>(null)
  const selectedCaseIdRef = useRef<string | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [evidence, setEvidence] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [timeline, setTimeline] = useState<any[]>([])
  const [profiles, setProfiles] = useState<any[]>([])

  const [newNote, setNewNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const canApprove = role === 'Supervisor' || role === 'Admin'

  const fetchCases = useCallback(async () => {
    const { data, error } = await supabase
      .from('cases')
      .select(`
        *,
        incident:incidents(*, camera:cameras(name, location)),
        assignee:profiles!cases_assigned_to_fkey(name, email)
      `)
      .order('created_at', { ascending: false })
    
    if (error) {
      setLoadError(error.message)
    } else {
      setLoadError(null)
      setCases(data ?? [])
      // Keep the open case in sync with the latest row.
      const openId = selectedCaseIdRef.current
      if (openId) {
        const fresh = (data ?? []).find((c: any) => c.id === openId)
        if (fresh) setSelectedCase(fresh)
      }
    }
    setLoading(false)
  }, [])

  const fetchCaseDetails = useCallback(async (caseId: string, incidentId?: string) => {
    const evidenceQuery = supabase.from('evidence').select('*, uploader:profiles(name)')
    
    if (incidentId) {
      evidenceQuery.or(`case_id.eq.${caseId},incident_id.eq.${incidentId}`)
    } else {
      evidenceQuery.eq('case_id', caseId)
    }

    const [evRes, notesRes, timeRes] = await Promise.all([
      evidenceQuery.order('capture_timestamp', { ascending: false }),
      supabase.from('case_notes').select('*, author:profiles(name, avatar)').eq('case_id', caseId).order('created_at', { ascending: true }),
      supabase.from('case_events').select('*, actor:profiles(name)').eq('case_id', caseId).order('created_at', { ascending: false })
    ])
    // Ignore responses for a case the user has already navigated away from.
    if (selectedCaseIdRef.current !== caseId) return
    setEvidence(evRes.data ?? [])
    setNotes(notesRes.data ?? [])
    setTimeline(timeRes.data ?? [])
    const err = evRes.error || notesRes.error || timeRes.error
    if (err) setActionError(`Some case details failed to load: ${err.message}`)
    setDetailsLoading(false)
  }, [])

  useEffect(() => {
    fetchCases()
    supabase.from('profiles').select('id, name, email, role').then(({ data }: any) => {
      if (data) setProfiles(data)
    })
    
    // Realtime: refresh list; refresh details only for the case currently open (via ref, not stale state).
    const refreshOpenCase = (payload: any) => {
      const openId = selectedCaseIdRef.current
      const rowCaseId = payload.new?.case_id ?? payload.old?.case_id
      if (openId && rowCaseId === openId) {
        const incId = selectedCase?.incident_id;
        fetchCaseDetails(openId, incId)
      }
    }
    const channel = supabase.channel('cases_board')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cases' }, () => fetchCases())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_notes' }, refreshOpenCase)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_events' }, refreshOpenCase)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'evidence' }, refreshOpenCase)
      .subscribe()
      
    return () => { supabase.removeChannel(channel) }
  }, [fetchCases, fetchCaseDetails])

  useEffect(() => {
    selectedCaseIdRef.current = selectedCase?.id ?? null
    if (selectedCase?.id) {
      setEvidence([])
      setNotes([])
      setTimeline([])
      setDetailsLoading(true)
      fetchCaseDetails(selectedCase.id, selectedCase.incident_id)
    }
  }, [selectedCase?.id, selectedCase?.incident_id, fetchCaseDetails])

  const handleUpdateStatus = async (newStatus: string) => {
    if (!selectedCase || !user) return
    if ((newStatus === 'Approved' || newStatus === 'Rejected') && !canApprove) {
      setActionError('Only Supervisors and Admins can approve or reject cases.')
      return
    }
    setActionError(null)
    const previous = selectedCase.status
    setSelectedCase({ ...selectedCase, status: newStatus })

    const { error } = await supabase.from('cases').update({ status: newStatus }).eq('id', selectedCase.id)
    if (error) {
      setSelectedCase((c: any) => c && { ...c, status: previous })
      setActionError(`Status update failed: ${error.message}`)
      return
    }
    await Promise.all([
      supabase.from('case_events').insert([{ case_id: selectedCase.id, actor_id: user.id, action: `Status changed from ${previous} to ${newStatus}` }]),
      supabase.from('audit_logs').insert([{ user_id: user.id, action: `Updated Case ${selectedCase.id.slice(0,8)} status to ${newStatus}` }])
    ])
  }

  const handleAssign = async (assigneeId: string) => {
    if (!selectedCase || !user) return
    setActionError(null)
    const assignee = profiles.find(p => p.id === assigneeId)
    const { error } = await supabase.from('cases').update({ assigned_to: assigneeId || null }).eq('id', selectedCase.id)
    if (error) {
      setActionError(`Assignment failed: ${error.message}`)
      return
    }
    setSelectedCase({ ...selectedCase, assigned_to: assigneeId || null, assignee })
    await Promise.all([
      supabase.from('case_events').insert([{ case_id: selectedCase.id, actor_id: user.id, action: assigneeId ? `Assigned case to ${assignee?.name || assignee?.email}` : 'Unassigned case' }]),
      supabase.from('audit_logs').insert([{ user_id: user.id, action: `Assigned Case ${selectedCase.id.slice(0,8)} to ${assignee?.email ?? 'nobody'}` }])
    ])
  }

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault()
    const note = newNote.trim()
    if (!note || !selectedCase || !user) return
    if (note.length > 5000) {
      setActionError('Notes are limited to 5,000 characters.')
      return
    }
    setIsSubmitting(true)
    setActionError(null)
    
    const { error } = await supabase.from('case_notes').insert([{
      case_id: selectedCase.id,
      author_id: user.id,
      note
    }])
    if (error) {
      setActionError(`Could not save note: ${error.message}`)
      setIsSubmitting(false)
      return
    }
    await supabase.from('case_events').insert([{ case_id: selectedCase.id, actor_id: user.id, action: `Added note` }])
    
    setNewNote('')
    fetchCaseDetails(selectedCase.id)
    setIsSubmitting(false)
  }

  const getStatusStyle = (status: string) => {
    switch(status) {
      case 'New': return "bg-blue-50 text-blue-700 border-blue-200"
      case 'Under Review': return "bg-amber-50 text-amber-700 border-amber-200"
      case 'Investigating': return "bg-purple-50 text-purple-700 border-purple-200"
      case 'Escalated': return "bg-red-50 text-red-700 border-red-200"
      case 'Approved': return "bg-emerald-50 text-emerald-700 border-emerald-200"
      case 'Closed': return "bg-slate-100 text-slate-700 border-slate-300"
      default: return "bg-slate-50 text-slate-700 border-slate-200"
    }
  }

  const filteredCases = cases.filter(c => {
    if (statusFilter !== 'All' && c.status !== statusFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!c.id.toLowerCase().includes(q) && 
          !c.incident?.incident_type?.toLowerCase().includes(q) &&
          !c.incident?.camera?.name?.toLowerCase().includes(q)) {
        return false
      }
    }
    return true
  })

  // Selected Case View
  if (selectedCase) {
    const inc = selectedCase.incident
    return (
      <div className="flex gap-6 h-[calc(100vh-140px)]">
        {/* Main Investigation Canvas */}
        <div className="flex-1 flex flex-col min-w-0">
          
          <header className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setSelectedCase(null)}
                className="px-3 py-1.5 text-[13px] font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                ← Back to Cases
              </button>
              <div>
                <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                  Case <span className="text-slate-500 font-mono text-base uppercase">#{selectedCase.id.split('-')[0]}</span>
                </h1>
                {detailsLoading && (
                  <span className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Refreshing...
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select 
                value={selectedCase.status}
                onChange={e => handleUpdateStatus(e.target.value)}
                disabled={role === 'Viewer'}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[13px] font-bold uppercase tracking-wider border appearance-none outline-none cursor-pointer disabled:opacity-50",
                  getStatusStyle(selectedCase.status)
                )}
              >
                <option value="New">New</option>
                <option value="Under Review">Under Review</option>
                <option value="Investigating">Investigating</option>
                <option value="Escalated">Escalated</option>
                <option value="Approved">Approved</option>
                <option value="Closed">Closed</option>
              </select>
              
              <button className="flex items-center gap-2 px-3 py-1.5 text-[13px] font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer">
                <FileSignature className="w-4 h-4" /> Export Report
              </button>
            </div>
          </header>

          {actionError && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
              {actionError}
            </div>
          )}

          <div className="grid grid-cols-3 gap-6 flex-1 overflow-hidden">
            
            <div className="col-span-2 flex flex-col gap-6 overflow-y-auto pr-2 pb-6">
              
              {/* Incident Details Card */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-900 text-base">Incident Overview</h3>
                  <span className={cn(
                    "px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider",
                    inc?.severity === 'Critical' ? "bg-red-100 text-red-700" :
                    inc?.severity === 'High' ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                  )}>
                    {inc?.severity} Severity
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Type</span>
                    <span className="font-semibold text-slate-800">{inc?.incident_type}</span>
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Time</span>
                    <span className="font-semibold text-slate-800">{new Date(inc?.created_at).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Location / Camera</span>
                    <span className="font-semibold text-slate-800">{inc?.camera?.name} • {inc?.camera?.location}</span>
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Assigned Investigator</span>
                    <select 
                      value={selectedCase.assigned_to || ''}
                      onChange={e => handleAssign(e.target.value)}
                      disabled={role === 'Viewer'}
                      className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-[13px] font-medium text-slate-700 outline-none"
                    >
                      <option value="">Unassigned</option>
                      {profiles.filter(p => p.role !== 'Viewer').map(p => (
                        <option key={p.id} value={p.id}>{p.name || p.email}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Evidence Viewer */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col h-[500px]">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <h3 className="font-bold text-slate-900 text-[14px] flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-slate-400" /> Evidence Exhibits
                    <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full text-xs ml-2">{evidence.length} items</span>
                  </h3>
                  <button className="text-[12px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer">
                    <Plus className="w-3 h-3" /> Upload Evidence
                  </button>
                </div>
                
                <div className="flex-1 bg-slate-900 relative overflow-hidden flex items-center justify-center p-4">
                  {evidence.length > 0 ? (
                    evidence[0].status === 'failed' ? (
                      <div className="text-center text-red-500">
                        <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p>Evidence upload failed.</p>
                      </div>
                    ) : evidence[0].status === 'uploading' || evidence[0].status === 'queued' ? (
                      <div className="text-center text-blue-400">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
                        <p>Processing evidence...</p>
                      </div>
                    ) : (
                      <img src={evidence[0].file_path ? supabase.storage.from('evidence').getPublicUrl(evidence[0].file_path).data.publicUrl : evidence[0].file_url} alt="Primary Evidence" className="max-w-full max-h-full object-contain rounded shadow-lg" />
                    )
                  ) : (
                    <div className="text-center text-slate-500">
                      <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                      <p>No visual evidence attached to this case.</p>
                    </div>
                  )}
                  {/* Badge Overlay */}
                  {evidence.length > 0 && evidence[0].confidence && (
                    <div className="absolute top-4 right-4 bg-black/60 backdrop-blur text-white px-3 py-1.5 rounded-lg text-[12px] font-bold border border-white/10 flex items-center gap-2">
                      <Shield className="w-3 h-3 text-emerald-400" /> AI Confidence: {(evidence[0].confidence * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
                
                <div className="p-3 bg-slate-50 border-t border-slate-200 flex gap-3 overflow-x-auto">
                  {evidence.map((ev, i) => (
                    <div key={ev.id} className={cn(
                      "w-20 h-20 rounded-lg bg-slate-200 flex-shrink-0 cursor-pointer overflow-hidden border-2 relative",
                      i === 0 ? "border-blue-500" : "border-transparent",
                      ev.status === 'failed' ? "border-red-500" : ""
                    )}>
                      {ev.status === 'failed' && <div className="absolute inset-0 bg-red-500/20 z-10" />}
                      {(ev.file_type.startsWith('image') || ev.file_type === 'snapshot' || ev.file_type === 'plate_crop') ? (
                        <img src={ev.thumbnail_path ? supabase.storage.from('evidence').getPublicUrl(ev.thumbnail_path).data.publicUrl : ev.file_path ? supabase.storage.from('evidence').getPublicUrl(ev.file_path).data.publicUrl : ev.file_url} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-slate-800 text-white"><VideoIcon className="w-6 h-6" /></div>
                      )}
                    </div>
                  ))}
                  <div className="w-20 h-20 rounded-lg bg-white border border-dashed border-slate-300 flex items-center justify-center text-slate-400 cursor-pointer hover:bg-slate-50 hover:text-slate-600 transition-colors">
                    <Plus className="w-6 h-6" />
                  </div>
                </div>
              </div>

              {/* Investigation Notes */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col">
                <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <h3 className="font-bold text-slate-900 text-[14px] flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-slate-400" /> Investigation Notes
                  </h3>
                </div>
                
                <div className="p-5 space-y-4 max-h-[300px] overflow-y-auto bg-slate-50/30">
                  {notes.length === 0 ? (
                    <p className="text-[13px] text-slate-500 text-center italic py-4">No notes added to this case yet.</p>
                  ) : (
                    notes.map(note => (
                      <div key={note.id} className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-[11px] font-bold uppercase shrink-0 text-slate-600 border border-white shadow-sm">
                          {note.author?.name?.charAt(0) || 'U'}
                        </div>
                        <div className="bg-white p-3 rounded-xl rounded-tl-none border border-slate-200 shadow-sm flex-1">
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-[12px] font-bold text-slate-900">{note.author?.name || 'Unknown'}</span>
                            <span className="text-[11px] text-slate-400">{formatDistanceToNow(new Date(note.created_at))} ago</span>
                          </div>
                          <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed">{note.note}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-white">
                  <form onSubmit={handleAddNote} className="flex gap-3">
                    <textarea 
                      value={newNote}
                      onChange={e => setNewNote(e.target.value)}
                      placeholder="Add an investigation note..."
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg p-3 text-[13px] outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none h-12"
                    />
                    <button 
                      type="submit"
                      disabled={isSubmitting || !newNote.trim()}
                      className="bg-blue-600 text-white px-4 rounded-lg text-[13px] font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      Post Note
                    </button>
                  </form>
                </div>
              </div>

            </div>

            {/* Right Sidebar: Timeline & Audit */}
            <div className="flex flex-col gap-6 overflow-y-auto pb-6">
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
                  <h3 className="font-bold text-slate-900 text-[14px] flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" /> Case Timeline
                  </h3>
                </div>
                <div className="p-5 flex-1 overflow-y-auto">
                  <div className="space-y-4">
                    {timeline.map((event, i) => (
                      <div key={event.id} className="flex gap-3 relative">
                        <div className="w-2.5 h-2.5 rounded-full bg-slate-300 mt-1.5 relative z-10 shrink-0 border-2 border-white"></div>
                        {i !== timeline.length - 1 && <div className="absolute left-[4px] top-4 bottom-[-20px] w-0.5 bg-slate-100"></div>}
                        <div>
                          <p className="text-[13px] text-slate-900 font-medium">{event.action}</p>
                          <p className="text-[11px] text-slate-500">
                            {new Date(event.created_at).toLocaleString()} • {event.actor?.name || 'System'}
                          </p>
                        </div>
                      </div>
                    ))}
                    {timeline.length === 0 && (
                      <div className="text-[13px] text-slate-500 italic">No events recorded.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    )
  }

  // Cases List View
  return (
    <div className="space-y-6 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[20px] font-bold text-slate-900">Case Management</h2>
          <p className="text-[14px] text-slate-500">Investigate incidents, review evidence, and manage enforcement actions.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <FolderSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Search cases..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {['All', 'New', 'Under Review', 'Investigating', 'Escalated', 'Approved', 'Closed'].map(filter => (
          <button
            key={filter}
            onClick={() => setStatusFilter(filter)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-all cursor-pointer",
              statusFilter === filter 
                ? "bg-slate-900 text-white shadow-sm" 
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            )}
          >
            {filter}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="p-3 mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          Failed to load cases: {loadError}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden min-h-[500px] relative">
        {loading ? (
           <div className="absolute inset-0 flex items-center justify-center">
             <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
           </div>
        ) : filteredCases.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-slate-50/50">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 border border-slate-200 shadow-sm">
              <FolderOpen className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">No Cases Found</h3>
            <p className="text-slate-500 text-[14px]">No investigation cases match your current filters.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Case ID</th>
                <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Incident Type</th>
                <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Severity</th>
                <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Camera</th>
                <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Assigned To</th>
                <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Created</th>
                <th className="px-5 py-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCases.map((c) => (
                <tr 
                  key={c.id} 
                  onClick={() => setSelectedCase(c)}
                  className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                >
                  <td className="px-5 py-4">
                    <span className="font-mono text-[13px] font-bold text-slate-900 uppercase">#{c.id.split('-')[0]}</span>
                  </td>
                  <td className="px-5 py-4 text-[13px] font-bold text-slate-700">{c.incident?.incident_type}</td>
                  <td className="px-5 py-4">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider",
                      c.incident?.severity === 'Critical' ? "text-red-700 bg-red-50" : 
                      c.incident?.severity === 'High' ? "text-amber-700 bg-amber-50" : "text-blue-700 bg-blue-50"
                    )}>
                      {c.incident?.severity}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-[13px] text-slate-600 font-medium">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      {c.incident?.camera?.name}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={cn(
                      "inline-flex px-2 py-1 rounded text-[11px] font-bold uppercase tracking-wider border",
                      getStatusStyle(c.status)
                    )}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {c.assignee ? (
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full bg-slate-200 text-[9px] font-bold flex items-center justify-center uppercase">{c.assignee.name?.charAt(0) || 'U'}</div>
                        <span className="text-[12px] font-medium text-slate-700">{c.assignee.name}</span>
                      </div>
                    ) : (
                      <span className="text-[12px] text-slate-400 italic">Unassigned</span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-[12px] text-slate-500">
                    {formatDistanceToNow(new Date(c.created_at))} ago
                  </td>
                  <td className="px-5 py-4 text-right">
                    <button className="text-blue-600 font-medium text-[13px] opacity-0 group-hover:opacity-100 transition-opacity">View Case →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
