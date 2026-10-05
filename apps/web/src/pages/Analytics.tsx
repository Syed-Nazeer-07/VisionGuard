import { useState, useEffect, useMemo } from 'react'
import { 
  BarChart3, Activity, Download, Loader2,
  Calendar, ShieldAlert, Camera as CameraIcon, AlertTriangle
} from 'lucide-react'
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts'
import { supabase } from '../lib/supabase'
import { subDays, startOfDay, format } from 'date-fns'

type TimeRange = 'today' | '7d' | '30d' | '90d'

export default function Analytics() {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d')
  const [loading, setLoading] = useState(true)
  
  // Real datasets
  const [incidents, setIncidents] = useState<any[]>([])
  const [cases, setCases] = useState<any[]>([])
  const [alerts, setAlerts] = useState<any[]>([])
  const [cameras, setCameras] = useState<any[]>([])

  useEffect(() => {
    async function fetchAnalyticsData() {
      setLoading(true)
      
      const now = new Date()
      let startDate: Date
      if (timeRange === 'today') {
        startDate = startOfDay(now)
      } else if (timeRange === '7d') {
        startDate = subDays(now, 7)
      } else if (timeRange === '30d') {
        startDate = subDays(now, 30)
      } else {
        startDate = subDays(now, 90)
      }

      const [incRes, casesRes, alertsRes, camsRes] = await Promise.all([
        supabase
          .from('incidents')
          .select('*, camera:cameras(name, location)')
          .gte('created_at', startDate.toISOString())
          .order('created_at', { ascending: true }),
        supabase
          .from('cases')
          .select('*')
          .gte('created_at', startDate.toISOString()),
        supabase
          .from('alerts')
          .select('*')
          .gte('created_at', startDate.toISOString()),
        supabase
          .from('cameras')
          .select('*')
          .eq('is_deleted', false)
      ])

      if (incRes.data) setIncidents(incRes.data)
      if (casesRes.data) setCases(casesRes.data)
      if (alertsRes.data) setAlerts(alertsRes.data)
      if (camsRes.data) setCameras(camsRes.data)

      setLoading(false)
    }

    fetchAnalyticsData()
  }, [timeRange])

  // Aggregate Volume Chart Data
  const volumeData = useMemo(() => {
    if (timeRange === 'today') {
      // 24 hour buckets
      const buckets: Record<string, number> = {}
      for (let h = 0; h < 24; h += 2) {
        const key = `${h.toString().padStart(2, '0')}:00`
        buckets[key] = 0
      }
      incidents.forEach(inc => {
        const d = new Date(inc.created_at)
        const hour = Math.floor(d.getHours() / 2) * 2
        const key = `${hour.toString().padStart(2, '0')}:00`
        if (buckets[key] !== undefined) {
          buckets[key] += 1
        }
      })
      return Object.entries(buckets).map(([time, count]) => ({ label: time, volume: count }))
    } else {
      // Daily buckets
      const daysCount = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
      const buckets: Record<string, number> = {}
      for (let i = daysCount - 1; i >= 0; i--) {
        const d = subDays(new Date(), i)
        const key = format(d, timeRange === '7d' ? 'EEE' : 'MMM dd')
        buckets[key] = 0
      }
      incidents.forEach(inc => {
        const d = new Date(inc.created_at)
        const key = format(d, timeRange === '7d' ? 'EEE' : 'MMM dd')
        if (buckets[key] !== undefined) {
          buckets[key] += 1
        }
      })
      return Object.entries(buckets).map(([label, count]) => ({ label, volume: count }))
    }
  }, [incidents, timeRange])

  // Aggregate Severity / Frequency Chart Data
  const severityTrendData = useMemo(() => {
    if (timeRange === 'today') {
      const buckets: Record<string, { label: string; critical: number; medium: number; low: number }> = {}
      for (let h = 0; h < 24; h += 4) {
        const key = `${h.toString().padStart(2, '0')}:00`
        buckets[key] = { label: key, critical: 0, medium: 0, low: 0 }
      }
      incidents.forEach(inc => {
        const d = new Date(inc.created_at)
        const hour = Math.floor(d.getHours() / 4) * 4
        const key = `${hour.toString().padStart(2, '0')}:00`
        if (buckets[key]) {
          if (inc.severity === 'Critical') buckets[key].critical += 1
          else if (inc.severity === 'Medium' || inc.severity === 'High') buckets[key].medium += 1
          else buckets[key].low += 1
        }
      })
      return Object.values(buckets)
    } else {
      const daysCount = timeRange === '7d' ? 7 : timeRange === '30d' ? 15 : 30
      const step = timeRange === '90d' ? 3 : timeRange === '30d' ? 2 : 1
      const buckets: Record<string, { label: string; critical: number; medium: number; low: number }> = {}
      
      for (let i = daysCount * step - 1; i >= 0; i -= step) {
        const d = subDays(new Date(), i)
        const key = format(d, 'MMM dd')
        buckets[key] = { label: key, critical: 0, medium: 0, low: 0 }
      }
      incidents.forEach(inc => {
        const d = new Date(inc.created_at)
        const key = format(d, 'MMM dd')
        if (buckets[key]) {
          if (inc.severity === 'Critical') buckets[key].critical += 1
          else if (inc.severity === 'Medium' || inc.severity === 'High') buckets[key].medium += 1
          else buckets[key].low += 1
        }
      })
      return Object.values(buckets)
    }
  }, [incidents, timeRange])

  // KPIs
  const totalIncidents = incidents.length
  const activeAlerts = alerts.filter(a => a.status === 'active').length
  const openCases = cases.filter(c => ['New', 'Investigating', 'Escalated', 'Under Review'].includes(c.status)).length
  const activeCameras = cameras.filter(c => c.status === 'online').length

  // Export CSV Handler
  const handleExportCSV = () => {
    if (incidents.length === 0) {
      alert('No data available to export for the selected period.')
      return
    }

    const headers = ['Incident ID', 'Type', 'Severity', 'Status', 'Camera', 'Created At']
    const rows = incidents.map(inc => [
      inc.id,
      inc.incident_type,
      inc.severity,
      inc.status,
      inc.camera?.name || 'Unknown',
      inc.created_at
    ])

    const csvContent = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `VisionGuard_Analytics_${timeRange}_${format(new Date(), 'yyyy-MM-dd')}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Traffic Analytics</h2>
          <p className="text-[13px] text-slate-500">Comprehensive overview of city-wide traffic patterns and violations.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Time Range Selector */}
          <div className="flex items-center bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
            {(['today', '7d', '30d', '90d'] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 text-[12px] font-bold rounded-md transition-all cursor-pointer ${
                  timeRange === range
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {range === 'today' ? 'Today' : range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : '90 Days'}
              </button>
            ))}
          </div>

          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-[13px] font-bold transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 flex flex-col items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
          <p className="text-slate-500 text-[14px] font-medium">Aggregating database traffic metrics...</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Incidents', value: totalIncidents.toString(), icon: BarChart3, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: 'Active Alerts', value: activeAlerts.toString(), icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
              { label: 'Open Cases', value: openCases.toString(), icon: ShieldAlert, color: 'text-purple-600', bg: 'bg-purple-50' },
              { label: 'Online Cameras', value: `${activeCameras} / ${cameras.length}`, icon: CameraIcon, color: 'text-emerald-600', bg: 'bg-emerald-50' },
            ].map((kpi, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-2 rounded-lg border border-slate-100 ${kpi.bg}`}>
                    <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                  </div>
                  <span className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider">
                    {timeRange === 'today' ? '24h window' : `${timeRange} period`}
                  </span>
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-900">{kpi.value}</div>
                  <div className="text-[12px] font-medium text-slate-500 uppercase tracking-wide mt-1">{kpi.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Traffic Incident Volume Trends */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Incident Volume Trend</h3>
                  <p className="text-[13px] text-slate-500">Number of detected incidents over the selected timeframe.</p>
                </div>
                <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                  {totalIncidents} total
                </span>
              </div>
              <div className="h-[300px]">
                {incidents.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <Activity className="w-10 h-10 opacity-30 mb-2" />
                    <p className="text-[13px]">No incidents recorded in this period</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={volumeData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                      <Tooltip 
                        cursor={{ fill: '#f8fafc' }}
                        contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar dataKey="volume" fill="#0f172a" radius={[4, 4, 0, 0]} name="Incidents" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Severity Breakdown Over Time */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <div className="mb-6">
                <h3 className="text-base font-bold text-slate-900">Incident Severity Breakdown</h3>
                <p className="text-[13px] text-slate-500">Distribution of critical and standard traffic infractions.</p>
              </div>
              <div className="h-[300px]">
                {incidents.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <Calendar className="w-10 h-10 opacity-30 mb-2" />
                    <p className="text-[13px]">No incident timeline data available</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={severityTrendData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorCritical" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25}/>
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorMedium" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} dy={10} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Area type="monotone" dataKey="critical" stroke="#ef4444" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCritical)" name="Critical" />
                      <Area type="monotone" dataKey="medium" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorMedium)" name="Medium/High" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

          </div>
        </>
      )}

    </div>
  )
}
