import { useState, useEffect, useMemo } from 'react'
import { 
  Camera, ShieldAlert, Activity, AlertOctagon,
  MapPin, Clock, ArrowRight,
  Loader2, Plus, Bell
} from 'lucide-react'
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { Link } from 'react-router-dom'
import { subHours } from 'date-fns'

export function Dashboard() {
  const { role } = useAuthStore()
  const [loading, setLoading] = useState(true)
  
  // Data states
  const [cameras, setCameras] = useState<any[]>([])
  const [incidents, setIncidents] = useState<any[]>([])
  const [cases, setCases] = useState<any[]>([])
  const [alerts, setAlerts] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  
  useEffect(() => {
    async function loadDashboard() {
      setLoading(true)
      
      const [camsRes, incRes, casesRes, alertsRes, logsRes] = await Promise.all([
        supabase.from('cameras').select('*').eq('is_deleted', false),
        supabase.from('incidents').select('*, cameras(name)').order('created_at', { ascending: false }).limit(50),
        supabase.from('cases').select('*, incident:incidents(severity)'),
        supabase.from('alerts').select('*'),
        supabase.from('audit_logs').select('*').order('timestamp', { ascending: false }).limit(10)
      ])
      
      if (camsRes.data) setCameras(camsRes.data)
      if (incRes.data) setIncidents(incRes.data)
      if (casesRes.data) setCases(casesRes.data)
      if (alertsRes.data) setAlerts(alertsRes.data)
      if (logsRes.data) setLogs(logsRes.data)
        
      setLoading(false)
    }
    
    loadDashboard()
  }, [])

  // Calculate real database metrics
  const openCases = useMemo(() => {
    return cases.filter(c => ['New', 'Investigating', 'Escalated', 'Under Review'].includes(c.status)).length
  }, [cases])

  const criticalCases = useMemo(() => {
    return cases.filter(c => c.incident?.severity === 'Critical' && c.status !== 'Closed').length
  }, [cases])

  const activeAlertsCount = useMemo(() => {
    return alerts.filter(a => a.status === 'active').length
  }, [alerts])

  // Derive 24-hour incident trend from real database records
  const trafficData = useMemo(() => {
    const cutoff = subHours(new Date(), 24)
    const buckets: Record<string, number> = {
      '00:00': 0, '04:00': 0, '08:00': 0, '12:00': 0, '16:00': 0, '20:00': 0, '23:59': 0
    }
    incidents.forEach(inc => {
      const d = new Date(inc.created_at)
      if (d >= cutoff) {
        const h = d.getHours()
        let slot = '23:59'
        if (h < 4) slot = '00:00'
        else if (h < 8) slot = '04:00'
        else if (h < 12) slot = '08:00'
        else if (h < 16) slot = '12:00'
        else if (h < 20) slot = '16:00'
        else if (h < 24) slot = '20:00'
        buckets[slot] = (buckets[slot] || 0) + 1
      }
    })
    return Object.entries(buckets).map(([time, volume]) => ({ time, volume }))
  }, [incidents])
  
  // Calculate incident distribution based on actual data
  const incidentData = useMemo(() => {
    const types = incidents.reduce((acc, curr) => {
      const t = curr.incident_type || 'Unclassified'
      acc[t] = (acc[t] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    const colors = ['#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#06b6d4']
    return Object.keys(types).map((type, i) => ({
      name: type,
      value: types[type],
      color: colors[i % colors.length]
    }))
  }, [incidents])

  if (loading) {
    return (
      <div className="h-[calc(100vh-136px)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (cameras.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-blue-100">
          <Activity className="w-8 h-8 text-blue-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-3">Welcome to VisionGuard</h2>
        <p className="text-slate-500 text-[15px] max-w-md mb-8">
          Your operations dashboard is empty. Add your first traffic camera or connect your VMS system to start analyzing real-time data.
        </p>
        {(role === 'Admin' || role === 'Operator') ? (
          <Link 
            to="/app/cameras"
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg text-[14px] font-bold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
          >
            <Plus className="w-5 h-5" /> Connect Camera Network
          </Link>
        ) : (
          <p className="text-[13px] text-slate-400 font-medium">Please contact your administrator to configure the system.</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      
      {/* KPI Row (All 6 Database Driven Metrics) */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Cameras', value: cameras.length.toString(), icon: Camera, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Incidents', value: incidents.length.toString(), icon: AlertOctagon, color: 'text-rose-600', bg: 'bg-rose-50' },
          { label: 'Cases', value: cases.length.toString(), icon: ShieldAlert, color: 'text-indigo-600', bg: 'bg-indigo-50' },
          { label: 'Alerts', value: activeAlertsCount.toString(), icon: Bell, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Open Cases', value: openCases.toString(), icon: Clock, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Critical Cases', value: criticalCases.toString(), icon: AlertOctagon, color: 'text-red-600', bg: 'bg-red-50' },
        ].map((kpi, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide">{kpi.label}</span>
              <div className={cn("p-2 rounded-lg", kpi.bg)}>
                <kpi.icon className={cn("w-4 h-4", kpi.color)} />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900 mt-auto">{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Second Section: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Incident Volume Trend (24h) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Incident Volume Trend (24h)</h3>
              <p className="text-[13px] text-slate-500">Hourly infractions detected across monitored feeds.</p>
            </div>
            <Link to="/app/analytics" className="text-[13px] font-medium text-blue-600 hover:text-blue-700 flex items-center cursor-pointer">
              View Detailed Report <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trafficData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  labelStyle={{ fontWeight: 'bold', color: '#0f172a' }}
                />
                <Area type="monotone" dataKey="volume" stroke="#3b82f6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorVolume)" name="Incidents" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Incident Distribution */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col">
          <h3 className="text-base font-bold text-slate-900 mb-6">Incident Distribution</h3>
          {incidentData.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <Activity className="w-12 h-12 mb-2 text-slate-200" />
              <p className="text-[13px] font-medium text-slate-500">No incidents recorded</p>
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-[200px] relative flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={incidentData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={85}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {incidentData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      itemStyle={{ fontWeight: '500' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
                  <span className="text-3xl font-bold text-slate-900">{incidents.length}</span>
                  <span className="text-[12px] font-medium text-slate-500 uppercase tracking-wide">Total</span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 overflow-y-auto max-h-[80px]">
                {incidentData.map((item, i) => (
                  <div key={i} className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }}></div>
                    <span className="text-[13px] text-slate-600 truncate">{item.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

      </div>

      {/* Third Section: Tables & Feeds */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Recent Incidents Table */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">Recent Incidents</h3>
            <Link to="/app/incidents" className="text-xs font-semibold text-blue-600 hover:text-blue-700">
              View all
            </Link>
          </div>
          <div className="overflow-x-auto flex-1">
            {incidents.length === 0 ? (
               <div className="flex items-center justify-center h-48 text-slate-500 text-[14px]">
                 No incidents recorded.
               </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-5 py-3 text-[12px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">Location / Camera</th>
                    <th className="px-5 py-3 text-[12px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">Type</th>
                    <th className="px-5 py-3 text-[12px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">Severity</th>
                    <th className="px-5 py-3 text-[12px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {incidents.slice(0, 5).map((incident) => (
                    <tr key={incident.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center space-x-2">
                          <MapPin className="w-4 h-4 text-slate-400" />
                          <span className="text-[14px] text-slate-600">{incident.cameras?.name || 'Camera Feed'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-[14px] text-slate-600">{incident.incident_type}</td>
                      <td className="px-5 py-3.5">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium",
                          incident.severity === 'Critical' ? "bg-red-50 text-red-700" :
                          incident.severity === 'High' ? "bg-orange-50 text-orange-700" :
                          incident.severity === 'Medium' ? "bg-amber-50 text-amber-700" :
                          "bg-green-50 text-green-700"
                        )}>
                          {incident.severity}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center space-x-1.5">
                          <div className={cn(
                            "w-1.5 h-1.5 rounded-full",
                            incident.status === 'Active' ? "bg-blue-500" : "bg-emerald-500"
                          )}></div>
                          <span className="text-[13px] font-medium text-slate-700">{incident.status}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="p-4 border-t border-slate-100 text-center">
            <Link to="/app/incidents" className="text-[13px] font-medium text-slate-600 hover:text-slate-900">View All Incidents</Link>
          </div>
        </div>

        {/* Live Operations Feed */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col h-full">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
              </div>
              <h3 className="text-base font-bold text-slate-900">System Logs</h3>
            </div>
            <Link to="/app/audit" className="text-xs font-semibold text-blue-600 hover:text-blue-700">
              Audit log
            </Link>
          </div>
          <div className="p-5 flex-1 overflow-y-auto space-y-5">
            {logs.length === 0 ? (
               <div className="flex items-center justify-center h-full text-slate-500 text-[13px]">
                 No recent activity.
               </div>
            ) : logs.map((log) => (
              <div key={log.id} className="flex space-x-3">
                <div className="mt-0.5">
                   <Activity className="w-5 h-5 text-blue-500" /> 
                </div>
                <div>
                  <p className="text-[14px] text-slate-700 leading-snug font-medium">{log.action}</p>
                  <div className="flex items-center space-x-1.5 mt-1">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span className="text-[12px] text-slate-500">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  )
}
