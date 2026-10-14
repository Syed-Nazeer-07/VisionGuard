import { useState, useEffect, useMemo } from 'react'
import { 
  Search, Download, ShieldCheck, 
  User, Activity, Settings2, Key, ChevronRight, ChevronLeft,
  Loader2, X, Eye, ShieldAlert, FileText, Filter, RotateCcw
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { subDays, startOfDay, format as formatDate, formatDistanceToNow } from 'date-fns'

// Safe metadata sanitizer to ensure no passwords, tokens, or secrets are ever exposed
function sanitizeAuditMetadata(meta: any): any {
  if (!meta || typeof meta !== 'object') return meta

  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth_token', 'private_key', 'service_role']
  
  if (Array.isArray(meta)) {
    return meta.map(item => sanitizeAuditMetadata(item))
  }

  const sanitized: Record<string, any> = {}
  for (const [k, v] of Object.entries(meta)) {
    const isSensitive = sensitiveKeys.some(sk => k.toLowerCase().includes(sk))
    if (isSensitive) {
      sanitized[k] = '•••••••• [REDACTED]'
    } else if (typeof v === 'object' && v !== null) {
      sanitized[k] = sanitizeAuditMetadata(v)
    } else {
      sanitized[k] = v
    }
  }
  return sanitized
}

export function AuditLogs() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [dateFilter, setDateFilter] = useState('All')
  
  // Pagination
  const [page, setPage] = useState(1)
  const pageSize = 12

  // Inspection Modal
  const [inspectedLog, setInspectedLog] = useState<any | null>(null)

  useEffect(() => {
    fetchLogs()
  }, [])

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*, profile:profiles(name, email, role)')
        .order('timestamp', { ascending: false })
        .limit(500)
      
      if (data && !error) {
        setLogs(data)
      }
    } catch (err) {
      console.warn('Failed to load audit logs:', err)
    } finally {
      setLoading(false)
    }
  }

  // Filter logs based on search, event type, and date range
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // 1. Search Query
      const q = searchQuery.toLowerCase().trim()
      if (q) {
        const idMatch = log.id?.toLowerCase().includes(q)
        const actionMatch = log.action?.toLowerCase().includes(q)
        const resourceMatch = log.resource?.toLowerCase().includes(q)
        const userMatch = log.profile?.name?.toLowerCase().includes(q) || log.profile?.email?.toLowerCase().includes(q)
        const metadataMatch = JSON.stringify(log.metadata || log.details || '').toLowerCase().includes(q)
        if (!idMatch && !actionMatch && !resourceMatch && !userMatch && !metadataMatch) return false
      }

      // 2. Category Filter
      if (typeFilter !== 'All') {
        const act = (log.action || '').toLowerCase()
        const res = (log.resource || '').toLowerCase()
        if (typeFilter === 'Auth' && !act.includes('login') && !act.includes('auth') && !act.includes('sign')) return false
        if (typeFilter === 'Security' && !act.includes('role') && !act.includes('user') && !act.includes('status') && !act.includes('perm') && !res.includes('security')) return false
        if (typeFilter === 'Operational' && !act.includes('case') && !act.includes('incident') && !act.includes('review') && !act.includes('queue')) return false
        if (typeFilter === 'System' && !act.includes('setting') && !act.includes('config') && !act.includes('system')) return false
      }

      // 3. Date Filter
      if (dateFilter !== 'All') {
        const logDate = new Date(log.timestamp || log.created_at)
        const now = new Date()
        if (dateFilter === 'Today' && logDate < startOfDay(now)) return false
        if (dateFilter === '7d' && logDate < subDays(now, 7)) return false
        if (dateFilter === '30d' && logDate < subDays(now, 30)) return false
      }

      return true
    })
  }, [logs, searchQuery, typeFilter, dateFilter])

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize))
  const paginatedLogs = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredLogs.slice(start, start + pageSize)
  }, [filteredLogs, page, pageSize])

  // Export CSV
  const handleExportCSV = () => {
    if (filteredLogs.length === 0) {
      alert('No audit logs available to export.')
      return
    }

    const headers = ['Timestamp', 'Log ID', 'User Name', 'User Email', 'Action', 'Resource', 'Details']
    const rows = filteredLogs.map(log => [
      log.timestamp || log.created_at,
      log.id,
      log.profile?.name || 'System / Service',
      log.profile?.email || 'N/A',
      log.action,
      log.resource || log.metadata?.resource || 'N/A',
      JSON.stringify(sanitizeAuditMetadata(log.metadata || log.details || {}))
    ])

    const csvContent = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `VisionGuard_AuditTrail_${formatDate(new Date(), 'yyyy-MM-dd')}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const getLogCategory = (action: string) => {
    const act = (action || '').toLowerCase()
    if (act.includes('login') || act.includes('auth') || act.includes('session')) return { label: 'Auth', color: 'text-emerald-500', icon: ShieldCheck }
    if (act.includes('role') || act.includes('user') || act.includes('security') || act.includes('disabled')) return { label: 'Security', color: 'text-rose-500', icon: Key }
    if (act.includes('setting') || act.includes('config')) return { label: 'System', color: 'text-slate-500', icon: Settings2 }
    return { label: 'Operational', color: 'text-blue-500', icon: Activity }
  }

  return (
    <div className="space-y-6 max-w-[1700px] mx-auto pb-12">
      
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">System Audit Trail</h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 font-mono">
              Immutable Records
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Historical transaction log of all administrative operations, security changes, and case resolutions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-lg text-xs font-bold transition-all shadow-2xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-2xs flex flex-col overflow-hidden">
        
        {/* Toolbar */}
        <div className="p-3.5 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Search by Event, Actor, Resource, or Metadata..." 
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              className="py-1.5 px-2.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-500 transition-colors shadow-2xs cursor-pointer"
            >
              <option value="All">All Categories</option>
              <option value="Auth">Authentication</option>
              <option value="Security">Security & Roles</option>
              <option value="Operational">Operations (Incidents/Cases)</option>
              <option value="System">System Configuration</option>
            </select>

            <select
              value={dateFilter}
              onChange={e => { setDateFilter(e.target.value); setPage(1); }}
              className="py-1.5 px-2.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-500 transition-colors shadow-2xs cursor-pointer"
            >
              <option value="All">All Time</option>
              <option value="Today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>

            {(searchQuery || typeFilter !== 'All' || dateFilter !== 'All') && (
              <button
                onClick={() => { setSearchQuery(''); setTypeFilter('All'); setDateFilter('All'); setPage(1); }}
                className="flex items-center gap-1 px-2 py-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg font-medium cursor-pointer"
                title="Reset Filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto min-h-[320px]">
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-2" />
              <p className="text-xs font-medium text-slate-500">Querying historical audit records from database...</p>
            </div>
          ) : paginatedLogs.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
              <Activity className="w-10 h-10 opacity-30 mb-2" />
              <p className="text-sm font-semibold text-slate-700">No audit logs found</p>
              <p className="text-xs text-slate-400 mt-1">Try clearing your search query or filters.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Timestamp</th>
                  <th className="px-5 py-3.5">Actor / User</th>
                  <th className="px-5 py-3.5">Action Event</th>
                  <th className="px-5 py-3.5">Target Resource</th>
                  <th className="px-5 py-3.5">Category</th>
                  <th className="px-4 py-3.5 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedLogs.map((log) => {
                  const category = getLogCategory(log.action)
                  const CategoryIcon = category.icon
                  const userName = log.profile?.name || log.profile?.email || (log.user_id ? 'Authenticated Staff' : 'System Agent')
                  const formattedTime = formatDate(new Date(log.timestamp || log.created_at), 'MMM d, yyyy h:mm:ss a')

                  return (
                    <tr 
                      key={log.id} 
                      onClick={() => setInspectedLog(log)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    >
                      <td className="px-5 py-3 text-slate-500 font-mono text-[11px]">
                        {formattedTime}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 font-medium text-slate-900">
                          {userName === 'System Agent' ? (
                            <Settings2 className="w-3.5 h-3.5 text-slate-400" />
                          ) : (
                            <User className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span className="truncate max-w-[180px]">{userName}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <CategoryIcon className={cn("w-3.5 h-3.5", category.color)} />
                          <span className="text-slate-800 font-semibold">{log.action}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-slate-600 font-mono text-[11px]">
                        {log.resource || log.metadata?.resource || '—'}
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                          {category.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setInspectedLog(log); }}
                          className="text-slate-400 group-hover:text-blue-600 p-1 rounded"
                          title="Inspect Event"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Footer */}
        <div className="p-3.5 border-t border-slate-100 bg-white flex items-center justify-between text-slate-500 text-xs">
          <div>
            Showing <span className="font-semibold text-slate-800">{filteredLogs.length > 0 ? (page - 1) * pageSize + 1 : 0}</span> to <span className="font-semibold text-slate-800">{Math.min(page * pageSize, filteredLogs.length)}</span> of <span className="font-semibold text-slate-800">{filteredLogs.length}</span> events
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-semibold px-2">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>

      {/* Inspect Event Modal */}
      {inspectedLog && (
        <div 
          className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-2xs flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setInspectedLog(null)}
        >
          <div 
            className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  <span>Audit Event Detail</span>
                </h3>
                <span className="text-[11px] font-mono text-slate-400 mt-0.5 block">
                  Event ID: #{inspectedLog.id}
                </span>
              </div>
              <button 
                onClick={() => setInspectedLog(null)}
                className="text-slate-400 hover:text-slate-800 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div>
                  <span className="text-slate-400 block font-medium">Action</span>
                  <span className="font-bold text-slate-900 mt-0.5 block">{inspectedLog.action}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Timestamp</span>
                  <span className="font-mono text-slate-900 mt-0.5 block">
                    {formatDate(new Date(inspectedLog.timestamp || inspectedLog.created_at), 'PPP pp')}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Actor</span>
                  <span className="font-medium text-slate-900 mt-0.5 block">
                    {inspectedLog.profile?.name || inspectedLog.profile?.email || inspectedLog.user_id || 'System'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Target Resource</span>
                  <span className="font-mono text-slate-900 mt-0.5 block">
                    {inspectedLog.resource || inspectedLog.metadata?.resource || '—'}
                  </span>
                </div>
              </div>

              <div>
                <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px] block mb-1.5">
                  Sanitized Event Metadata (JSON)
                </span>
                <div className="p-3 bg-slate-900 rounded-lg overflow-x-auto text-emerald-400 font-mono text-[11px]">
                  <pre>{JSON.stringify(sanitizeAuditMetadata(inspectedLog.metadata || inspectedLog.details || {}), null, 2)}</pre>
                </div>
                <span className="text-[10px] text-slate-400 mt-1 block">
                  Confidential tokens, secrets, and credentials are automatically redacted in compliance with security audit standards.
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setInspectedLog(null)}
                className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold cursor-pointer hover:bg-slate-800"
              >
                Close Inspection
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
export default AuditLogs
