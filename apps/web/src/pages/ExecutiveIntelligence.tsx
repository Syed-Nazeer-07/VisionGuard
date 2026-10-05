import { useState, useEffect, useMemo } from 'react'
import { 
  TrendingUp, TrendingDown, Target, Clock, ShieldAlert,
  Camera, AlertOctagon, Lightbulb, LineChart, Loader2
} from 'lucide-react'
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { differenceInHours, subDays } from 'date-fns'

export function ExecutiveIntelligence() {
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState<number>(30)
  
  // Datasets
  const [cameras, setCameras] = useState<any[]>([])
  const [currentIncidents, setCurrentIncidents] = useState<any[]>([])
  const [previousIncidents, setPreviousIncidents] = useState<any[]>([])
  const [currentCases, setCurrentCases] = useState<any[]>([])
  const [previousCases, setPreviousCases] = useState<any[]>([])

  useEffect(() => {
    async function fetchExecutiveData() {
      setLoading(true)
      const now = new Date()
      const currentStart = subDays(now, timeRange)
      const previousStart = subDays(now, timeRange * 2)

      const [camsRes, curIncRes, prevIncRes, curCasesRes, prevCasesRes] = await Promise.all([
        supabase.from('cameras').select('*').eq('is_deleted', false),
        supabase
          .from('incidents')
          .select('*, camera:cameras(name, location)')
          .gte('created_at', currentStart.toISOString()),
        supabase
          .from('incidents')
          .select('id, created_at, severity')
          .gte('created_at', previousStart.toISOString())
          .lt('created_at', currentStart.toISOString()),
        supabase
          .from('cases')
          .select('*')
          .gte('created_at', currentStart.toISOString()),
        supabase
          .from('cases')
          .select('*')
          .gte('created_at', previousStart.toISOString())
          .lt('created_at', currentStart.toISOString())
      ])
      
      if (camsRes.data) setCameras(camsRes.data)
      if (curIncRes.data) setCurrentIncidents(curIncRes.data)
      if (prevIncRes.data) setPreviousIncidents(prevIncRes.data)
      if (curCasesRes.data) setCurrentCases(curCasesRes.data)
      if (prevCasesRes.data) setPreviousCases(prevCasesRes.data)
        
      setLoading(false)
    }

    fetchExecutiveData()
  }, [timeRange])

  // --- Real KPI Calculations & Historical Trends ---
  const activeCameras = cameras.filter(c => c.status === 'online').length
  const uptime = cameras.length ? ((activeCameras / cameras.length) * 100).toFixed(1) : '0.0'
  
  const openCases = currentCases.filter(c => !['Closed', 'Approved', 'Rejected'].includes(c.status)).length
  const prevOpenCases = previousCases.filter(c => !['Closed', 'Approved', 'Rejected'].includes(c.status)).length
  const closedCases = currentCases.filter(c => ['Closed', 'Approved'].includes(c.status)).length
  
  // Real Incident Trend
  const incidentDelta = previousIncidents.length > 0 
    ? (((currentIncidents.length - previousIncidents.length) / previousIncidents.length) * 100).toFixed(1)
    : currentIncidents.length > 0 ? '+100%' : '0%'
  const incidentTrendUp = currentIncidents.length >= previousIncidents.length

  // Real Open Cases Trend
  const openCasesDelta = prevOpenCases > 0
    ? (((openCases - prevOpenCases) / prevOpenCases) * 100).toFixed(1)
    : openCases > 0 ? '+100%' : '0%'
  const openCasesTrendPos = openCases <= prevOpenCases // fewer open cases is positive

  // Avg Resolution Time (hours)
  const avgResolutionTime = useMemo(() => {
    let totalHours = 0
    let resolvedCount = 0
    currentCases.forEach(c => {
      if (c.status === 'Closed' && c.created_at && c.updated_at) {
        totalHours += differenceInHours(new Date(c.updated_at), new Date(c.created_at))
        resolvedCount++
      }
    })
    return resolvedCount > 0 ? (totalHours / resolvedCount).toFixed(1) : 'N/A'
  }, [currentCases])

  // Real Detection Accuracy from verified incidents
  const detectionAccuracy = useMemo(() => {
    const reviewed = currentIncidents.filter(i => i.verified !== null && i.verified !== undefined)
    if (reviewed.length === 0) return 'N/A'
    const verifiedTrue = reviewed.filter(i => i.verified === true).length
    return ((verifiedTrue / reviewed.length) * 100).toFixed(1)
  }, [currentIncidents])

  // --- Dynamic Insights Generation (Derived Only from Real Metrics) ---
  const insights = useMemo(() => {
    if (currentIncidents.length === 0) {
      return [{
        title: 'Zero Infractions in Window',
        desc: `No incidents recorded across active cameras during the selected ${timeRange}-day period.`,
        type: 'positive'
      }]
    }

    const cards = []
    
    // 1. Camera Concentration
    const cameraCounts = currentIncidents.reduce((acc, curr) => {
      if (curr.camera_id) acc[curr.camera_id] = (acc[curr.camera_id] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    const sortedCameraIds = Object.keys(cameraCounts).sort((a,b) => cameraCounts[b] - cameraCounts[a])
    if (sortedCameraIds.length > 0) {
      const worstId = sortedCameraIds[0]
      const worstCount = cameraCounts[worstId]
      const pct = (worstCount / currentIncidents.length) * 100
      const worstName = cameras.find(c => c.id === worstId)?.name || 'Primary Feed'

      if (pct >= 15) {
        cards.push({
          title: 'High Incident Concentration',
          desc: `Camera ${worstName} accounts for ${pct.toFixed(1)}% (${worstCount} incidents) of all infractions in this window.`,
          type: 'negative'
        })
      }
    }

    // 2. Incident severity distribution
    const criticals = currentIncidents.filter(i => i.severity === 'Critical').length
    if (criticals > currentIncidents.length * 0.2 && criticals > 0) {
      const critPct = ((criticals / currentIncidents.length) * 100).toFixed(1)
      cards.push({
        title: 'Critical Severity Alert',
        desc: `${critPct}% of recent incidents (${criticals} cases) are classified as Critical severity.`,
        type: 'negative'
      })
    }

    // 3. Efficiency / Backlog
    if (avgResolutionTime !== 'N/A' && Number(avgResolutionTime) <= 24) {
      cards.push({
        title: 'High Operational Efficiency',
        desc: `Average case resolution time is ${avgResolutionTime} hours, operating within operational SLA standards.`,
        type: 'positive'
      })
    } else if (openCases > closedCases * 2 && openCases > 5) {
      cards.push({
        title: 'Case Backlog Accumulating',
        desc: `Active open cases (${openCases}) exceed closed cases (${closedCases}). Additional reviewer capacity recommended.`,
        type: 'negative'
      })
    }

    if (cards.length === 0) {
      cards.push({
        title: 'Operational Baseline Stable',
        desc: `Operational metrics across ${cameras.length} camera feeds are within normal thresholds.`,
        type: 'positive'
      })
    }
    
    return cards.slice(0, 3)
  }, [currentIncidents, cameras, avgResolutionTime, openCases, closedCases, timeRange])

  // --- Real Chart Trend Data ---
  const trendData = useMemo(() => {
    const data = []
    const step = timeRange === 90 ? 3 : timeRange === 30 ? 2 : 1
    const totalDays = timeRange

    for (let i = totalDays - 1; i >= 0; i -= step) {
      const d = subDays(new Date(), i)
      const start = new Date(d)
      start.setHours(0, 0, 0, 0)
      const end = new Date(d)
      end.setHours(23, 59, 59, 999)
      
      const dayIncidents = currentIncidents.filter(inc => {
        const incDate = new Date(inc.created_at)
        return incDate >= start && incDate <= end
      }).length
      
      const dayCases = currentCases.filter(c => {
        const cDate = new Date(c.created_at)
        return cDate >= start && cDate <= end
      }).length

      data.push({
        name: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        incidents: dayIncidents,
        cases: dayCases
      })
    }
    return data
  }, [currentIncidents, currentCases, timeRange])

  // Real Hotspot Cameras
  const hotspotData = useMemo(() => {
    const counts = currentIncidents.reduce((acc, curr) => {
      const name = curr.camera?.name || 'Unassigned Feed'
      acc[name] = (acc[name] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    return Object.keys(counts)
      .map(name => ({ name, incidents: counts[name] }))
      .sort((a, b) => b.incidents - a.incidents)
      .slice(0, 5)
  }, [currentIncidents])

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
        <p className="text-slate-500 text-[14px] font-medium">Gathering executive intelligence...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[1600px]">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold text-slate-900">Executive Intelligence Center</h2>
          <p className="text-[14px] text-slate-500">High-level operational insights and performance metrics.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Real Time Range Selector */}
          <div className="bg-white border border-slate-200 rounded-lg p-1 flex shadow-sm">
            {[7, 30, 90].map(days => (
              <button 
                key={days}
                onClick={() => setTimeRange(days)}
                className={cn(
                  "px-3 py-1.5 text-[12px] font-bold rounded cursor-pointer transition-colors",
                  timeRange === days ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                )}
              >
                {days}D
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Blocks with Real Historical Trends */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {[
          { 
            label: 'Total Incidents', 
            value: currentIncidents.length.toString(), 
            icon: AlertOctagon, 
            color: 'text-rose-600', 
            trend: `${incidentTrendUp ? '+' : ''}${incidentDelta}`, 
            pos: !incidentTrendUp 
          },
          { 
            label: 'Open Cases', 
            value: openCases.toString(), 
            icon: ShieldAlert, 
            color: 'text-amber-600', 
            trend: `${openCases <= prevOpenCases ? '-' : '+'}${openCasesDelta}`, 
            pos: openCasesTrendPos 
          },
          { 
            label: 'Camera Uptime', 
            value: `${uptime}%`, 
            icon: Camera, 
            color: 'text-blue-600', 
            trend: `${activeCameras} active`, 
            pos: activeCameras > 0 
          },
          { 
            label: 'Avg Resolution', 
            value: avgResolutionTime === 'N/A' ? 'N/A' : `${avgResolutionTime}h`, 
            icon: Clock, 
            color: 'text-purple-600', 
            trend: avgResolutionTime === 'N/A' ? 'Awaiting data' : 'Closed cases', 
            pos: true 
          },
          { 
            label: 'Detection Acc.', 
            value: detectionAccuracy === 'N/A' ? 'N/A' : `${detectionAccuracy}%`, 
            icon: Target, 
            color: 'text-emerald-600', 
            trend: detectionAccuracy === 'N/A' ? 'Unreviewed' : 'Verified', 
            pos: true 
          },
        ].map((kpi, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col relative overflow-hidden group">
            <div className="flex items-center justify-between mb-3 relative z-10">
              <span className="text-[12px] font-bold text-slate-400 uppercase tracking-wider">{kpi.label}</span>
              <kpi.icon className={cn("w-4 h-4", kpi.color)} />
            </div>
            <div className="flex items-end gap-2 relative z-10">
              <div className="text-3xl font-bold text-slate-900">{kpi.value}</div>
              <div className={cn("flex items-center text-[11px] font-bold pb-1", kpi.pos ? "text-emerald-600" : "text-rose-600")}>
                {kpi.trend.includes('+') ? <TrendingUp className="w-3 h-3 mr-0.5" /> : kpi.trend.includes('-') ? <TrendingDown className="w-3 h-3 mr-0.5" /> : null}
                {kpi.trend}
              </div>
            </div>
            <div className={cn("absolute -bottom-4 -right-4 w-16 h-16 rounded-full opacity-[0.03] group-hover:scale-150 transition-transform duration-500", kpi.color.replace('text-', 'bg-'))}></div>
          </div>
        ))}
      </div>

      {/* Main Analytical Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Trend Area Chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-base font-bold text-slate-900">Incident & Case Velocity</h3>
              <p className="text-[13px] text-slate-500">Correlation between raw detections and generated investigative cases.</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-semibold">
              <div className="flex items-center gap-1.5 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Incidents
              </div>
              <div className="flex items-center gap-1.5 text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-900"></span> Cases
              </div>
            </div>
          </div>
          <div className="h-[320px]">
            {currentIncidents.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <LineChart className="w-10 h-10 opacity-30 mb-2" />
                <p className="text-[13px]">No velocity trend data available</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorIncidents" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorCases" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0f172a" stopOpacity={0.15}/>
                      <stop offset="95%" stopColor="#0f172a" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Area type="monotone" dataKey="incidents" stroke="#3b82f6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorIncidents)" name="Incidents" />
                  <Area type="monotone" dataKey="cases" stroke="#0f172a" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCases)" name="Cases" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Hotspots & High Risk Feeds */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col">
          <div className="mb-4">
            <h3 className="text-base font-bold text-slate-900">Camera Infraction Hotspots</h3>
            <p className="text-[13px] text-slate-500">Top 5 cameras by incident frequency.</p>
          </div>
          <div className="flex-1 min-h-[260px]">
            {hotspotData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <Camera className="w-10 h-10 opacity-30 mb-2" />
                <p className="text-[13px]">No camera hotspot data</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hotspotData} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#0f172a', fontWeight: 'bold' }} width={100} />
                  <RechartsTooltip 
                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="incidents" fill="#0f172a" radius={[0, 4, 4, 0]} name="Incidents" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

      </div>

      {/* Dynamic Strategic Insights Grid */}
      <div>
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-500" /> Operational Intelligence & Recommendations
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {insights.map((item, i) => (
            <div 
              key={i} 
              className={cn(
                "p-5 rounded-xl border transition-all shadow-sm flex flex-col justify-between",
                item.type === 'positive' 
                  ? "bg-emerald-50/50 border-emerald-200 text-emerald-950" 
                  : "bg-rose-50/50 border-rose-200 text-rose-950"
              )}
            >
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={cn(
                    "w-2 h-2 rounded-full",
                    item.type === 'positive' ? "bg-emerald-500" : "bg-rose-500"
                  )}></span>
                  <h4 className="font-bold text-[14px]">{item.title}</h4>
                </div>
                <p className="text-[13px] leading-relaxed opacity-90">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
