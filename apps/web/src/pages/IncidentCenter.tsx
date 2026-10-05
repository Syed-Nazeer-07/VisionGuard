import { useState, useEffect } from 'react'
import { 
  Search, Filter, CheckCircle2, Clock, 
  MapPin, User, MoreHorizontal, ChevronRight,
  ImageIcon,
  Loader2
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'

export function IncidentCenter() {
  const [activeFilter, setActiveFilter] = useState('All')
  const [incidents, setIncidents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIncident, setSelectedIncident] = useState<any | null>(null)

  useEffect(() => {
    fetchIncidents()
  }, [])

  const fetchIncidents = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('incidents')
      .select('*, cameras(name), profiles(name)')
      .order('created_at', { ascending: false })
    
    if (data) {
      setIncidents(data)
    }
    setLoading(false)
  }

  const filteredIncidents = incidents.filter(inc => {
    if (activeFilter === 'Active') return inc.status === 'Active'
    if (activeFilter === 'Resolved') return inc.status === 'Resolved'
    if (activeFilter === 'Critical') return inc.severity === 'Critical'
    if (activeFilter === 'Today') {
      const today = new Date().toDateString()
      return new Date(inc.created_at).toDateString() === today
    }
    return true
  })

  return (
    <div className="flex h-[calc(100vh-136px)] gap-6">
      
      {/* Main Table Area */}
      <div className={cn("flex-1 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col transition-all duration-300", selectedIncident ? "w-2/3" : "w-full")}>
        
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {['All', 'Active', 'Critical', 'Resolved', 'Today'].map(filter => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-all cursor-pointer",
                  activeFilter === filter 
                    ? "bg-slate-900 text-white shadow-sm" 
                    : "text-slate-600 hover:bg-slate-100"
                )}
              >
                {filter}
              </button>
            ))}
          </div>
          
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Search incidents..." 
                className="w-64 pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
              />
            </div>
            <button className="flex items-center gap-2 py-2 px-3 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm cursor-pointer">
              <Filter className="w-3.5 h-3.5" /> Filter
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
          ) : incidents.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-100">
                <CheckCircle2 className="w-8 h-8 text-slate-300" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">No incidents recorded</h3>
              <p className="text-slate-500 max-w-sm text-[14px]">
                Your operations environment is currently clear. Any new traffic anomalies or system alerts will appear here.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 bg-slate-50 z-10 shadow-[0_1px_0_rgba(226,232,240,1)]">
                <tr>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Incident ID</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Type & Severity</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Location</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Time</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Operator</th>
                  <th className="px-5 py-3.5 text-[12px] font-bold text-slate-500 uppercase tracking-wider text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredIncidents.map((inc) => (
                  <tr 
                    key={inc.id} 
                    onClick={() => setSelectedIncident(inc)}
                    className={cn(
                      "transition-colors cursor-pointer group hover:bg-blue-50/50",
                      selectedIncident?.id === inc.id ? "bg-blue-50/80" : ""
                    )}
                  >
                    <td className="px-5 py-4 text-[13px] font-bold text-slate-900">{inc.id.split('-')[0]}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="text-[14px] font-medium text-slate-700">{inc.incident_type}</div>
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider",
                          inc.severity === 'Critical' ? "bg-red-50 text-red-700" :
                          inc.severity === 'High' ? "bg-orange-50 text-orange-700" :
                          inc.severity === 'Medium' ? "bg-amber-50 text-amber-700" :
                          "bg-slate-100 text-slate-700"
                        )}>
                          {inc.severity}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-[13px] text-slate-600">{inc.location || 'Unknown'}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-[13px] text-slate-600">
                      {new Date(inc.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1.5">
                        <div className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          inc.status === 'Active' ? "bg-blue-500 animate-pulse" : "bg-emerald-500"
                        )}></div>
                        <span className="text-[13px] font-medium text-slate-700">{inc.status}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-[13px] text-slate-600 flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                        <User className="w-3 h-3 text-slate-500" />
                      </div>
                      {inc.profiles?.name || 'Unassigned'}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button className="text-slate-400 hover:text-slate-900 transition-colors cursor-pointer">
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Side Drawer (Incident Details) */}
      {selectedIncident && (
        <div className="w-96 flex-shrink-0 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col animate-in slide-in-from-right-4 duration-300">
          
          <div className="p-5 border-b border-slate-100 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-lg font-bold text-slate-900">{selectedIncident.id.split('-')[0]}</h2>
                <span className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider",
                  selectedIncident.status === 'Active' ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"
                )}>
                  {selectedIncident.status}
                </span>
              </div>
              <p className="text-[13px] text-slate-500">{selectedIncident.incident_type} • {selectedIncident.severity} Severity</p>
            </div>
            <button 
              onClick={() => setSelectedIncident(null)}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            
            {/* Snapshot Evidence */}
            <div className="p-5 border-b border-slate-100">
              <h3 className="text-[12px] font-bold text-slate-400 uppercase tracking-wider mb-3">Evidence Snapshot</h3>
              <div className="w-full h-40 bg-slate-100 rounded-lg border border-slate-200 flex flex-col items-center justify-center text-slate-400 relative overflow-hidden group cursor-pointer hover:bg-slate-200 transition-colors">
                <ImageIcon className="w-8 h-8 mb-2" />
                <span className="text-[12px] font-medium">Click to view high-res image</span>
                <div className="absolute top-2 right-2 bg-black/50 backdrop-blur rounded px-2 py-1 text-[10px] text-white font-bold tracking-wider">
                  {selectedIncident.cameras?.name || 'Unknown Cam'}
                </div>
              </div>
            </div>

            {/* Details List */}
            <div className="p-5 border-b border-slate-100 space-y-4">
              <div>
                <span className="block text-[12px] font-bold text-slate-400 uppercase tracking-wider mb-1">Location</span>
                <div className="flex items-center gap-2 text-[14px] text-slate-900 font-medium">
                  <MapPin className="w-4 h-4 text-slate-400" /> {selectedIncident.location || 'Unknown'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="block text-[12px] font-bold text-slate-400 uppercase tracking-wider mb-1">Detected At</span>
                  <div className="flex items-center gap-2 text-[14px] text-slate-900 font-medium">
                    <Clock className="w-4 h-4 text-slate-400" /> 
                    {new Date(selectedIncident.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </div>
                </div>
                <div>
                  <span className="block text-[12px] font-bold text-slate-400 uppercase tracking-wider mb-1">Assigned To</span>
                  <div className="flex items-center gap-2 text-[14px] text-slate-900 font-medium">
                    <User className="w-4 h-4 text-slate-400" /> {selectedIncident.profiles?.name || 'Unassigned'}
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="p-5">
              <h3 className="text-[12px] font-bold text-slate-400 uppercase tracking-wider mb-4">Incident Timeline</h3>
              <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
                
                <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-4 h-4 rounded-full border-2 border-white bg-slate-300 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10"></div>
                  <div className="w-[calc(100%-2.5rem)] md:w-[calc(50%-1.25rem)] p-3 rounded-lg border border-slate-200 bg-white shadow-sm ml-4 md:ml-0 md:mr-4 md:group-even:ml-4 md:group-even:mr-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-bold text-slate-900 text-[13px]">AI Detection</div>
                      <time className="text-[11px] font-medium text-slate-500">
                        {new Date(selectedIncident.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </time>
                    </div>
                    <div className="text-slate-600 text-[12px]">System flagged anomaly on camera.</div>
                  </div>
                </div>

              </div>
            </div>

          </div>

          <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex gap-2 shrink-0">
            <button className="flex-1 bg-slate-900 hover:bg-slate-800 text-white py-2 rounded-lg text-[13px] font-bold transition-colors shadow-sm cursor-pointer">
              Take Action
            </button>
            <button className="flex-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 py-2 rounded-lg text-[13px] font-bold transition-colors shadow-sm cursor-pointer">
              Resolve
            </button>
          </div>

        </div>
      )}

    </div>
  )
}
