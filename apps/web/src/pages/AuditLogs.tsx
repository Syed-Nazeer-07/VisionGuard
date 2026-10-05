import { useState, useEffect, useMemo } from 'react'
import { 
  Search, Download, ShieldCheck, 
  User, Activity, Settings2, Key, ChevronRight, ChevronLeft,
  Loader2
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { subDays, startOfDay, format } from 'date-fns'

export function AuditLogs() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [dateFilter, setDateFilter] = useState('All')
  const [page, setPage] = useState(1)
  const pageSize = 12

  useEffect(() => {
    fetchLogs()
  }, [])

  const fetchLogs = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('audit_logs')
      .select('*, profile:profiles(name, email)')
      .order('timestamp', { ascending: false })
      .limit(500)
    
    if (data) {
      setLogs(data)
    }
    setLoading(false)
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
        const detailsMatch = typeof log.details === 'string' 
          ? log.details.toLowerCase().includes(q) 
          : JSON.stringify(log.details || '').toLowerCase().includes(q)
        if (!idMatch && !actionMatch && !resourceMatch && !userMatch && !detailsMatch) return false
      }

      // 2. Type Filter
      if (typeFilter !== 'All') {
        const actionLower = (log.action || '').toLowerCase()
        const resourceLower = (log.resource || '').toLowerCase()
        if (typeFilter === 'Auth' && !actionLower.includes('login') && !actionLower.includes('auth') && !actionLower.includes('sign')) return false
        if (typeFilter === 'Security' && !actionLower.includes('role') && !actionLower.includes('status') && !actionLower.includes('perm') && !resourceLower.includes('security')) return false
        if (typeFilter === 'Operational' && !actionLower.includes('case') && !actionLower.includes('incident') && !actionLower.includes('camera')) return false
        if (typeFilter === 'System' && !actionLower.includes('setting') && !actionLower.includes('config') && !actionLower.includes('system')) return false
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

  // Handle export CSV
  const handleExportCSV = () => {
    if (filteredLogs.length === 0) {
      alert('No audit logs available to export.')
      return
    }

    const headers = ['Timestamp', 'Log ID', 'User', 'User Email', 'Action', 'Resource', 'Details']
    const rows = filteredLogs.map(log => [
      log.timestamp || log.created_at,
      log.id,
      log.profile?.name || 'System / Service',
      log.profile?.email || 'N/A',
      log.action,
      log.resource || 'N/A',
      typeof log.details === 'object' ? JSON.stringify(log.details) : String(log.details || '')
    ])

    const csvContent = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `VisionGuard_AuditLogs_${format(new Date(), 'yyyy-MM-dd')}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Get visual badge type
  const getLogCategory = (action: string) => {
    const act = (action || '').toLowerCase()
    if (act.includes('login') || act.includes('auth')) return { label: 'Auth', color: 'text-emerald-500', icon: ShieldCheck }
    if (act.includes('role') || act.includes('security') || act.includes('permission')) return { label: 'Security', color: 'text-rose-500', icon: Key }
    if (act.includes('setting') || act.includes('config')) return { label: 'System', color: 'text-slate-500', icon: Settings2 }
    return { label: 'Operational', color: 'text-blue-500', icon: Activity }
  }

  return (
    <div className="space-y-6">
      
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">System Audit Trail</h2>
          <p className="text-[13px] text-slate-500">Immutable record of all system events, actions, and administrative activities.</p>
        </div>
        <button 
          onClick={handleExportCSV}
          className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-[13px] font-bold transition-all shadow-sm cursor-pointer"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Main Card */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
        
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Search by ID, User, Action or Resource..." 
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-[13px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            {/* Event Type Filter */}
            <select
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
              className="py-2 px-3 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-700 focus:outline-none focus:border-slate-400 transition-colors shadow-sm cursor-pointer"
            >
              <option value="All">All Categories</option>
              <option value="Auth">Authentication</option>
              <option value="Security">Security & Roles</option>
              <option value="Operational">Operations</option>
              <option value="System">System Config</option>
            </select>

            {/* Date Range Filter */}
            <select
              value={dateFilter}
              onChange={e => { setDateFilter(e.target.value); setPage(1); }}
              className="py-2 px-3 bg-white border border-slate-200 rounded-lg text-[13px] font-medium text-slate-700 focus:outline-none focus:border-slate-400 transition-colors shadow-sm cursor-pointer"
            >
              <option value="All">All Time</option>
              <option value="Today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto min-h-[300px]">
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-2" />
              <p className="text-[13px] font-medium text-slate-500">Loading audit records from database...</p>
            </div>
          ) : paginatedLogs.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400">
              <Activity className="w-10 h-10 opacity-30 mb-2" />
              <p className="text-[14px] font-semibold text-slate-700">No audit logs found</p>
              <p className="text-[12px] text-slate-400 mt-1">Try clearing your search query or filters.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="bg-white border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-[12px] font-bold text-slate-400 uppercase tracking-wider">Timestamp</th>
                  <th className="px-6 py-4 text-[12px] font-bold text-slate-400 uppercase tracking-wider">User / Agent</th>
                  <th className="px-6 py-4 text-[12px] font-bold text-slate-400 uppercase tracking-wider">Event</th>
                  <th className="px-6 py-4 text-[12px] font-bold text-slate-400 uppercase tracking-wider">Resource Target</th>
                  <th className="px-6 py-4 text-[12px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-[13px]">
                {paginatedLogs.map((log) => {
                  const category = getLogCategory(log.action)
                  const CategoryIcon = category.icon
                  const userName = log.profile?.name || (log.user_id ? 'Authenticated User' : 'System')
                  const formattedTime = new Date(log.timestamp || log.created_at).toLocaleString()

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-3.5 text-slate-500">
                        {formattedTime}
                      </td>
                      <td className="px-6 py-3.5 font-sans">
                        <div className="flex items-center gap-2 font-medium text-slate-900">
                          {userName === 'System' ? (
                            <Settings2 className="w-4 h-4 text-slate-400" />
                          ) : (
                            <User className="w-4 h-4 text-slate-400" />
                          )}
                          <span>{userName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3.5 font-sans">
                        <div className="flex items-center gap-2">
                          <CategoryIcon className={cn("w-4 h-4", category.color)} />
                          <span className="text-slate-800 font-medium">{log.action}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3.5 text-slate-600 font-sans">
                        {log.resource || '—'}
                      </td>
                      <td className="px-6 py-3.5 font-sans">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700">
                          Success
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Real Pagination Footer */}
        <div className="p-4 border-t border-slate-100 bg-white flex items-center justify-between text-slate-500 text-[13px]">
          <div>
            Showing <span className="font-semibold text-slate-800">{filteredLogs.length > 0 ? (page - 1) * pageSize + 1 : 0}</span> to <span className="font-semibold text-slate-800">{Math.min(page * pageSize, filteredLogs.length)}</span> of <span className="font-semibold text-slate-800">{filteredLogs.length}</span> entries
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold px-2">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>

    </div>
  )
}
