import { useState, useEffect, useMemo } from 'react'
import { 
  Search, CheckCircle2, XCircle, AlertTriangle, 
  ChevronRight, Camera, Clock, Target, Loader2
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

export default function ReviewQueue() {
  const { user } = useAuthStore()
  const [incidents, setIncidents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIncident, setSelectedIncident] = useState<any | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('All')
  const [isProcessingAction, setIsProcessingAction] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)

  useEffect(() => {
    fetchQueue()
  }, [])

  const fetchQueue = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('incidents')
      .select('*, camera:cameras(name, location), case:cases(*)')
      .neq('status', 'Resolved')
      .neq('status', 'Rejected')
      .order('created_at', { ascending: false })
      .limit(100)

    if (data) {
      setIncidents(data)
      if (selectedIncident) {
        const updated = data.find((i: any) => i.id === selectedIncident.id)
        setSelectedIncident(updated || null)
      }
    }
    setLoading(false)
  }

  // Handle Review Actions
  const handleReviewAction = async (action: 'approve' | 'reject' | 'escalate') => {
    if (!selectedIncident || !user) return
    setIsProcessingAction(true)
    setActionFeedback(null)

    try {
      const incidentId = selectedIncident.id
      const caseRecord = Array.isArray(selectedIncident.case) ? selectedIncident.case[0] : selectedIncident.case

      if (action === 'approve') {
        // 1. Update incident
        await supabase
          .from('incidents')
          .update({
            status: 'Resolved',
            resolved_at: new Date().toISOString(),
            assigned_to: user.id
          })
          .eq('id', incidentId)

        // 2. Update case
        if (caseRecord?.id) {
          await supabase
            .from('cases')
            .update({
              status: 'Approved',
              updated_at: new Date().toISOString()
            })
            .eq('id', caseRecord.id)

          // 3. Log case event
          await supabase.from('case_events').insert([{
            case_id: caseRecord.id,
            actor_id: user.id,
            action: 'Approved: Verified by reviewer in Review Queue'
          }])
        }

        // 4. Audit Log
        await supabase.from('audit_logs').insert([{
          user_id: user.id,
          action: 'Approve Incident',
          metadata: { incident_id: incidentId, status: 'Approved' }
        }])

        setActionFeedback('Incident verified and marked Approved.')
      } else if (action === 'reject') {
        // 1. Update incident
        await supabase
          .from('incidents')
          .update({
            status: 'Rejected',
            resolved_at: new Date().toISOString(),
            assigned_to: user.id
          })
          .eq('id', incidentId)

        // 2. Update case
        if (caseRecord?.id) {
          await supabase
            .from('cases')
            .update({
              status: 'Rejected',
              updated_at: new Date().toISOString()
            })
            .eq('id', caseRecord.id)

          await supabase.from('case_events').insert([{
            case_id: caseRecord.id,
            actor_id: user.id,
            action: 'Rejected: Marked as false positive by reviewer'
          }])
        }

        // 3. Audit Log
        await supabase.from('audit_logs').insert([{
          user_id: user.id,
          action: 'Reject Incident',
          metadata: { incident_id: incidentId, status: 'Rejected' }
        }])

        setActionFeedback('Incident rejected as false positive.')
      } else if (action === 'escalate') {
        // 1. Update incident
        await supabase
          .from('incidents')
          .update({
            severity: 'Critical',
            status: 'Active'
          })
          .eq('id', incidentId)

        // 2. Update case
        if (caseRecord?.id) {
          await supabase
            .from('cases')
            .update({
              status: 'Escalated',
              updated_at: new Date().toISOString()
            })
            .eq('id', caseRecord.id)

          await supabase.from('case_events').insert([{
            case_id: caseRecord.id,
            actor_id: user.id,
            action: 'Escalated: Escalated for immediate supervisor review'
          }])
        }

        // 3. Audit Log
        await supabase.from('audit_logs').insert([{
          user_id: user.id,
          action: 'Escalate Incident',
          metadata: { incident_id: incidentId, status: 'Escalated' }
        }])

        setActionFeedback('Incident escalated for supervisor review.')
      }

      // Refresh list
      await fetchQueue()
      setTimeout(() => {
        setSelectedIncident(null)
        setActionFeedback(null)
      }, 1000)
    } catch (err: any) {
      console.error('Failed to perform review action:', err)
      setActionFeedback(`Action failed: ${err.message}`)
    } finally {
      setIsProcessingAction(false)
    }
  }

  // Filter queue
  const filteredQueue = useMemo(() => {
    return incidents.filter(inc => {
      if (filterType !== 'All' && inc.incident_type !== filterType) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase().trim()
        const matchId = inc.id?.toLowerCase().includes(q)
        const matchType = inc.incident_type?.toLowerCase().includes(q)
        const matchCam = inc.camera?.name?.toLowerCase().includes(q)
        if (!matchId && !matchType && !matchCam) return false
      }
      return true
    })
  }, [incidents, filterType, searchQuery])

  // Extract unique types for dropdown
  const uniqueTypes = useMemo(() => {
    const set = new Set<string>()
    incidents.forEach(i => { if (i.incident_type) set.add(i.incident_type) })
    return Array.from(set)
  }, [incidents])

  return (
    <div className="flex h-[calc(100vh-136px)] gap-6">
      
      {/* Main Queue Area */}
      <div className={cn("flex-1 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col transition-all duration-300", selectedIncident ? "w-2/3" : "w-full")}>
        
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Review Queue</h2>
            <p className="text-[13px] text-slate-500">Manual verification required for AI-flagged incidents.</p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search events..." 
                className="w-64 pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[13px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="py-2 px-3 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-700 outline-none focus:border-slate-400 cursor-pointer shadow-sm"
            >
              <option value="All">All Types</option>
              {uniqueTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-2" />
              <p className="text-[13px] font-medium text-slate-500">Loading pending verification queue...</p>
            </div>
          ) : filteredQueue.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-3" />
              <h3 className="text-base font-bold text-slate-900 mb-1">Queue Clear</h3>
              <p className="text-[13px] text-slate-500 max-w-sm">All AI-flagged incidents have been verified or resolved.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 bg-slate-50 z-10 shadow-[0_1px_0_rgba(226,232,240,1)]">
                <tr>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Event ID</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Detection Type</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">AI Confidence</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Camera</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Time</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredQueue.map((evt) => {
                  const conf = evt.metadata?.plate_confidence ? Math.round(evt.metadata.plate_confidence * 100) : (evt.confidence ? Math.round(Number(evt.confidence) * 100) : 92)
                  const timeFormatted = new Date(evt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

                  return (
                    <tr 
                      key={evt.id} 
                      onClick={() => setSelectedIncident(evt)}
                      className={cn(
                        "transition-colors cursor-pointer group hover:bg-slate-50/80",
                        selectedIncident?.id === evt.id ? "bg-slate-50" : ""
                      )}
                    >
                      <td className="px-5 py-4 text-[13px] font-bold text-slate-900 font-mono">#{evt.id.slice(0, 8)}</td>
                      <td className="px-5 py-4 text-[14px] font-medium text-slate-700">
                        {evt.incident_type}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div 
                              className={cn("h-full rounded-full", conf > 90 ? "bg-emerald-500" : "bg-amber-500")} 
                              style={{ width: `${conf}%` }}
                            ></div>
                          </div>
                          <span className="text-[12px] font-bold text-slate-700">{conf}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-[13px] text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Camera className="w-3.5 h-3.5 text-slate-400" /> {evt.camera?.name || 'Live Feed'}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-[13px] text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" /> {timeFormatted}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button className="text-slate-400 hover:text-slate-900 transition-colors">
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Verification Side Panel */}
      {selectedIncident && (
        <div className="w-96 flex-shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col animate-in slide-in-from-right-4 duration-300">
          
          <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div>
              <h2 className="text-[14px] font-bold text-slate-900 tracking-tight font-mono">Review #{selectedIncident.id.slice(0, 8)}</h2>
              <p className="text-[12px] text-slate-500 mt-0.5">{selectedIncident.incident_type} • {selectedIncident.severity} Severity</p>
            </div>
            <button 
              onClick={() => setSelectedIncident(null)}
              className="text-[12px] font-semibold text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            
            {/* Evidence Image / Camera Frame */}
            <div className="w-full aspect-video bg-slate-900 rounded-lg shadow-sm border border-slate-200 relative overflow-hidden group mb-6 flex items-center justify-center">
              {selectedIncident.snapshot_url ? (
                <img 
                  src={selectedIncident.snapshot_url} 
                  alt="Incident Snapshot" 
                  className="w-full h-full object-cover" 
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-500">
                  <Camera className="w-8 h-8 opacity-40 mb-1" />
                  <span className="text-[11px]">Camera Feed Frame</span>
                </div>
              )}
              <div className="absolute top-2 left-2 bg-black/60 backdrop-blur rounded px-2 py-1 flex items-center gap-1.5">
                <Target className="w-3 h-3 text-red-400" />
                <span className="text-[10px] text-white font-bold tracking-wider uppercase">{selectedIncident.camera?.name || 'CAM'}</span>
              </div>
            </div>

            {/* AI Analysis Metadata */}
            <div className="space-y-4">
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Detection Parameters</h3>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="block text-[11px] text-slate-500 font-medium mb-1">Confidence</span>
                  <span className="text-[14px] font-bold text-emerald-600">
                    {selectedIncident.metadata?.plate_confidence ? `${Math.round(selectedIncident.metadata.plate_confidence * 100)}%` : (selectedIncident.confidence ? `${Math.round(Number(selectedIncident.confidence) * 100)}%` : '92%')}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="block text-[11px] text-slate-500 font-medium mb-1">Status</span>
                  <span className="text-[14px] font-bold text-slate-900">{selectedIncident.status}</span>
                </div>
              </div>

              {selectedIncident.metadata?.speed && (
                <div className="bg-red-50 border border-red-100 p-3 rounded-lg flex justify-between items-center">
                  <div>
                    <span className="block text-[11px] text-red-500 font-bold uppercase tracking-wider mb-1">Detected Speed</span>
                    <span className="text-[16px] font-bold text-red-700">{Math.round(selectedIncident.metadata.speed)} km/h</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[11px] text-slate-500 font-medium mb-1">Posted Limit</span>
                    <span className="text-[14px] font-bold text-slate-700">{selectedIncident.metadata.speed_limit || 60} km/h</span>
                  </div>
                </div>
              )}

              {selectedIncident.description && (
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <span className="block text-[11px] text-slate-500 font-medium mb-1">AI Diagnostic</span>
                  <p className="text-[12px] text-slate-700 leading-relaxed">{selectedIncident.description}</p>
                </div>
              )}

              {actionFeedback && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-lg font-medium">
                  {actionFeedback}
                </div>
              )}
            </div>

          </div>

          {/* Action Buttons (Database Mutators) */}
          <div className="p-4 border-t border-slate-100 grid grid-cols-3 gap-2 shrink-0 bg-white">
            <button 
              onClick={() => handleReviewAction('approve')}
              disabled={isProcessingAction}
              className="flex flex-col items-center justify-center gap-1.5 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors border border-emerald-200 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {isProcessingAction ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              <span className="text-[11px] font-bold uppercase tracking-wider">Approve</span>
            </button>
            <button 
              onClick={() => handleReviewAction('reject')}
              disabled={isProcessingAction}
              className="flex flex-col items-center justify-center gap-1.5 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors border border-slate-200 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {isProcessingAction ? <Loader2 className="w-5 h-5 animate-spin" /> : <XCircle className="w-5 h-5" />}
              <span className="text-[11px] font-bold uppercase tracking-wider">Reject</span>
            </button>
            <button 
              onClick={() => handleReviewAction('escalate')}
              disabled={isProcessingAction}
              className="flex flex-col items-center justify-center gap-1.5 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg transition-colors border border-red-200 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {isProcessingAction ? <Loader2 className="w-5 h-5 animate-spin" /> : <AlertTriangle className="w-5 h-5" />}
              <span className="text-[11px] font-bold uppercase tracking-wider">Escalate</span>
            </button>
          </div>

        </div>
      )}

    </div>
  )
}
