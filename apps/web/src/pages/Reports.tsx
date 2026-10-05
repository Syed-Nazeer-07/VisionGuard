import { useState, useEffect } from 'react'
import { 
  FileText, Download, Calendar, FileBarChart, 
  Settings2, CheckCircle2, MoreVertical,
  FileSpreadsheet, FileCode2, Clock, Loader2,
  Activity, AlertTriangle
} from 'lucide-react'
import { cn } from '../lib/utils'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { subDays, startOfDay, format as formatDate } from 'date-fns'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export function Reports() {
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState<'library' | 'builder' | 'scheduled'>('builder')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateMessage, setGenerateMessage] = useState<string | null>(null)
  
  const [scheduledReports, setScheduledReports] = useState<any[]>([])
  const [savedReports, setSavedReports] = useState<any[]>([])
  const [loadingSaved, setLoadingSaved] = useState(false)
  
  const [executionMetrics, setExecutionMetrics] = useState({
    totalScheduled: 0,
    generatedToday: 0,
    successRate: 0,
    failedExecutions: 0
  })
  
  // Builder State
  const [reportType, setReportType] = useState('Traffic')
  const [dateRange, setDateRange] = useState('Last 7 Days')
  const [format, setFormat] = useState('PDF')
  const [isScheduled, setIsScheduled] = useState(false)
  const [scheduleFreq, setScheduleFreq] = useState('Weekly')

  useEffect(() => {
    fetchScheduled()
    fetchSaved()
    fetchMetrics()
  }, [])

  const fetchMetrics = async () => {
    const today = new Date()
    today.setHours(0,0,0,0)

    const { data: scheduled } = await supabase.from('scheduled_reports').select('id')
    const { data: executions } = await supabase.from('report_executions').select('status, started_at')
    
    if (executions) {
      const todayExecs = executions.filter((e: any) => new Date(e.started_at) >= today)
      const generatedToday = todayExecs.filter((e: any) => e.status === 'completed').length
      const failedExecutions = executions.filter((e: any) => e.status === 'failed').length
      const completedExecutions = executions.filter((e: any) => e.status === 'completed').length
      const totalFinished = completedExecutions + failedExecutions
      const successRate = totalFinished > 0 ? Math.round((completedExecutions / totalFinished) * 100) : 0

      setExecutionMetrics({
        totalScheduled: scheduled?.length || 0,
        generatedToday,
        successRate,
        failedExecutions
      })
    }
  }

  const fetchScheduled = async () => {
    const { data } = await supabase.from('scheduled_reports').select('*').order('created_at', { ascending: false })
    if (data) setScheduledReports(data)
  }

  const fetchSaved = async () => {
    setLoadingSaved(true)
    const { data } = await supabase.from('saved_reports').select('*').order('created_at', { ascending: false })
    if (data) setSavedReports(data)
    setLoadingSaved(false)
  }

  const getStartDate = () => {
    const now = new Date()
    if (dateRange === 'Today') return startOfDay(now)
    if (dateRange === 'Last 7 Days') return subDays(now, 7)
    if (dateRange === 'Last 30 Days') return subDays(now, 30)
    return subDays(now, 90)
  }

  // Real Database Driven Report Generation (CSV & PDF)
  const handleGenerate = async () => {
    setIsGenerating(true)
    setGenerateMessage(null)

    try {
      const startDate = getStartDate()
      let records: any[] = []
      let headers: string[] = []
      let tableData: string[][] = []

      // 1. Query real data from database based on reportType
      if (reportType === 'Traffic' || reportType === 'Incidents') {
        const { data, error } = await supabase
          .from('incidents')
          .select('id, incident_type, severity, status, created_at, cameras(name, location)')
          .gte('created_at', startDate.toISOString())
          .order('created_at', { ascending: false })
          .limit(500)

        if (error) throw error
        records = data || []
        headers = ['Incident ID', 'Type', 'Severity', 'Status', 'Camera', 'Timestamp']
        tableData = records.map(r => [
          `#${r.id.slice(0, 8)}`,
          r.incident_type || 'General',
          r.severity || 'Medium',
          r.status || 'Active',
          r.cameras?.name || 'Unassigned',
          new Date(r.created_at).toLocaleString()
        ])
      } else if (reportType === 'Enforcement') {
        const { data, error } = await supabase
          .from('cases')
          .select('id, status, created_at, incident:incidents(incident_type, severity, cameras(name))')
          .gte('created_at', startDate.toISOString())
          .order('created_at', { ascending: false })
          .limit(500)

        if (error) throw error
        records = data || []
        headers = ['Case ID', 'Status', 'Violation Type', 'Severity', 'Camera', 'Created At']
        tableData = records.map(r => [
          `#${r.id.slice(0, 8)}`,
          r.status,
          r.incident?.incident_type || 'Traffic Case',
          r.incident?.severity || 'Medium',
          r.incident?.cameras?.name || 'Street Camera',
          new Date(r.created_at).toLocaleString()
        ])
      } else {
        // System / Audit
        const { data, error } = await supabase
          .from('audit_logs')
          .select('id, action, resource, timestamp, profile:profiles(name)')
          .gte('timestamp', startDate.toISOString())
          .order('timestamp', { ascending: false })
          .limit(500)

        if (error) throw error
        records = data || []
        headers = ['Log ID', 'User', 'Action', 'Resource', 'Timestamp']
        tableData = records.map(r => [
          `#${r.id.slice(0, 8)}`,
          r.profile?.name || 'System',
          r.action,
          r.resource || 'System Setting',
          new Date(r.timestamp).toLocaleString()
        ])
      }

      const timestampStr = formatDate(new Date(), 'yyyy-MM-dd_HHmm')
      const fileName = `${reportType}_Report_${timestampStr}.${format.toLowerCase()}`

      // 2. Generate actual file based on format
      if (format === 'CSV') {
        const csvRows = [
          headers.join(','),
          ...tableData.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        ]
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } else {
        // PDF Export using jsPDF and AutoTable
        const doc = new jsPDF()
        
        // Header
        doc.setFillColor(15, 23, 42) // Slate 900
        doc.rect(0, 0, 210, 32, 'F')
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(16)
        doc.setFont('helvetica', 'bold')
        doc.text('VISIONGUARD INTELLIGENCE PLATFORM', 14, 15)
        doc.setFontSize(10)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(203, 213, 225)
        doc.text(`${reportType.toUpperCase()} OPERATIONAL REPORT • GENERATED ${new Date().toLocaleString()}`, 14, 24)

        // Metadata summary
        doc.setTextColor(15, 23, 42)
        doc.setFontSize(11)
        doc.setFont('helvetica', 'bold')
        doc.text(`Time Range: ${dateRange}`, 14, 42)
        doc.text(`Total Records: ${records.length}`, 80, 42)
        doc.text(`Generated By: ${user?.email || 'Administrator'}`, 140, 42)

        // AutoTable
        autoTable(doc, {
          startY: 48,
          head: [headers],
          body: tableData.length > 0 ? tableData : [['No records found for the selected timeframe', '', '', '', '', '']],
          theme: 'striped',
          headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 9, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          margin: { top: 48, left: 14, right: 14 }
        })

        doc.save(fileName)
      }

      // 3. Persist to saved_reports
      if (user?.id) {
        await supabase.from('saved_reports').insert([{
          title: `${reportType} Summary (${dateRange})`,
          config: {
            reportType,
            dateRange,
            format,
            recordCount: records.length,
            fileName
          },
          created_by: user.id
        }])
        await fetchSaved()
      }

      setGenerateMessage(`Successfully generated ${records.length} records in ${fileName}`)
      setTimeout(() => setGenerateMessage(null), 4000)
    } catch (err: any) {
      console.error('Report generation failed:', err)
      setGenerateMessage(`Export failed: ${err.message}`)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSchedule = async () => {
    setIsGenerating(true)
    const nextRun = new Date()
    nextRun.setDate(nextRun.getDate() + (scheduleFreq === 'Daily' ? 1 : scheduleFreq === 'Weekly' ? 7 : 30))
    
    await supabase.from('scheduled_reports').insert([{
      name: `${reportType} Summary (${scheduleFreq})`,
      type: reportType,
      frequency: scheduleFreq,
      format,
      recipients: user?.email ? [user.email] : [],
      next_run_at: nextRun.toISOString(),
      created_by: user?.id
    }])
    
    await fetchScheduled()
    setIsGenerating(false)
    setActiveTab('scheduled')
  }

  return (
    <div className="space-y-6 max-w-[1600px]">
      
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[20px] font-bold text-slate-900">Report Center</h2>
          <p className="text-[14px] text-slate-500">Generate, export, and schedule custom operational reports.</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {[
          { id: 'builder', label: 'Custom Builder', icon: Settings2 },
          { id: 'library', label: 'Report Library', icon: FileBarChart },
          { id: 'scheduled', label: 'Scheduled Exports', icon: Clock }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "flex items-center gap-2 px-4 py-3 text-[13px] font-bold border-b-2 transition-all cursor-pointer",
              activeTab === tab.id 
                ? "border-blue-600 text-blue-600" 
                : "border-transparent text-slate-500 hover:text-slate-800"
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'builder' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-6">
              <div>
                <label className="block text-[13px] font-bold text-slate-900 mb-2">Report Domain</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {['Traffic', 'Incidents', 'Enforcement', 'System'].map(type => (
                    <button
                      key={type}
                      onClick={() => setReportType(type)}
                      className={cn(
                        "p-3 rounded-lg border text-left cursor-pointer transition-all",
                        reportType === type 
                          ? "border-blue-600 bg-blue-50/50 text-blue-900" 
                          : "border-slate-200 hover:border-slate-300 text-slate-600"
                      )}
                    >
                      <span className="block font-bold text-[14px]">{type}</span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">Database audit</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-bold text-slate-900 mb-2">Timeframe</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {['Today', 'Last 7 Days', 'Last 30 Days', 'Last 90 Days'].map(range => (
                    <button
                      key={range}
                      onClick={() => setDateRange(range)}
                      className={cn(
                        "p-3 rounded-lg border text-center cursor-pointer transition-all text-[13px] font-bold",
                        dateRange === range 
                          ? "border-blue-600 bg-blue-50/50 text-blue-900" 
                          : "border-slate-200 hover:border-slate-300 text-slate-600"
                      )}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-bold text-slate-900 mb-2">Output Format</label>
                <div className="grid grid-cols-2 gap-3 max-w-sm">
                  {[
                    { id: 'PDF', label: 'PDF Document', desc: 'Formatted with charts & tables', icon: FileText },
                    { id: 'CSV', label: 'CSV Spreadsheet', desc: 'Raw tabular export', icon: FileCode2 },
                  ].map(f => (
                    <button
                      key={f.id}
                      onClick={() => setFormat(f.id)}
                      className={cn(
                        "p-3 rounded-lg border text-left cursor-pointer transition-all flex items-start gap-3",
                        format === f.id 
                          ? "border-blue-600 bg-blue-50/50 text-blue-900" 
                          : "border-slate-200 hover:border-slate-300 text-slate-600"
                      )}
                    >
                      <f.icon className={cn("w-5 h-5 shrink-0 mt-0.5", format === f.id ? "text-blue-600" : "text-slate-400")} />
                      <div>
                        <span className="block font-bold text-[13px]">{f.label}</span>
                        <span className="block text-[11px] text-slate-500">{f.desc}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className={cn(
                      "w-10 h-6 rounded-full transition-colors relative",
                      isScheduled ? "bg-blue-600" : "bg-slate-300 group-hover:bg-slate-400"
                    )} onClick={() => setIsScheduled(!isScheduled)}>
                      <div className={cn(
                        "w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm",
                        isScheduled ? "left-5" : "left-1"
                      )}></div>
                    </div>
                    <div>
                      <span className="block text-[13px] font-bold text-slate-900">Schedule Automatic Delivery</span>
                      <span className="block text-[11px] text-slate-500">Record scheduled runner in database</span>
                    </div>
                  </label>

                  {isScheduled && (
                    <select 
                      value={scheduleFreq}
                      onChange={e => setScheduleFreq(e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-[12px] font-bold text-slate-700 outline-none cursor-pointer"
                    >
                      <option>Daily</option>
                      <option>Weekly</option>
                      <option>Monthly</option>
                    </select>
                  )}
                </div>
              </div>

              {generateMessage && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded-lg font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                  <span>{generateMessage}</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-slate-900 rounded-xl shadow-xl overflow-hidden border border-slate-800 text-white flex flex-col h-full">
              <div className="p-6 border-b border-white/10 flex-1">
                <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center mb-6">
                  {format === 'PDF' ? <FileText className="w-6 h-6 text-blue-400" /> : 
                   <FileCode2 className="w-6 h-6 text-emerald-400" />}
                </div>
                
                <h3 className="text-xl font-bold mb-2">Report Specification</h3>
                <p className="text-slate-400 text-[13px] mb-6">
                  Real data will be pulled from live tables and generated on-demand as {format}.
                </p>

                <div className="space-y-3">
                  <div className="flex justify-between text-[13px] border-b border-white/10 pb-2">
                    <span className="text-slate-500">Target Table</span>
                    <span className="font-medium text-slate-200">{reportType === 'System' ? 'audit_logs' : reportType === 'Enforcement' ? 'cases' : 'incidents'}</span>
                  </div>
                  <div className="flex justify-between text-[13px] border-b border-white/10 pb-2">
                    <span className="text-slate-500">Time Window</span>
                    <span className="font-medium text-slate-200">{dateRange}</span>
                  </div>
                  <div className="flex justify-between text-[13px] border-b border-white/10 pb-2">
                    <span className="text-slate-500">Action</span>
                    <span className="font-medium text-slate-200">{isScheduled ? 'Save Schedule' : 'Immediate Export'}</span>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-white/5 shrink-0">
                <button 
                  onClick={isScheduled ? handleSchedule : handleGenerate}
                  disabled={isGenerating}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg text-[14px] transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : 
                   isScheduled ? <><Calendar className="w-4 h-4" /> Schedule Report</> : 
                   <><Download className="w-4 h-4" /> Export Real {format}</>}
                </button>
              </div>
            </div>
          </div>

        </div>
      )}

      {activeTab === 'library' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          {loadingSaved ? (
            <div className="p-12 text-center flex flex-col items-center">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
              <p className="text-slate-500 text-[14px]">Loading saved reports from database...</p>
            </div>
          ) : savedReports.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <FileSpreadsheet className="w-12 h-12 text-slate-300 mb-4" />
              <h3 className="text-lg font-bold text-slate-900 mb-2">Report Library is Empty</h3>
              <p className="text-slate-500 text-[14px] max-w-md">
                Generated reports will be recorded here in the database. Use the Custom Builder to generate your first export.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Report Title</th>
                  <th className="px-5 py-3 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Format</th>
                  <th className="px-5 py-3 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Records</th>
                  <th className="px-5 py-3 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Generated At</th>
                  <th className="px-5 py-3 text-[12px] font-bold text-slate-500 uppercase tracking-wider text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {savedReports.map(rep => (
                  <tr key={rep.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 font-bold text-slate-900 text-[13px]">{rep.title}</td>
                    <td className="px-5 py-4">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[11px] font-bold uppercase">
                        {rep.config?.format || 'PDF'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[13px] text-slate-600 font-medium">
                      {rep.config?.recordCount ?? '—'} rows
                    </td>
                    <td className="px-5 py-4 text-[13px] text-slate-600">
                      {new Date(rep.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                        Saved in DB
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === 'scheduled' && (
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1">Scheduled Reports</p>
                <div className="text-2xl font-bold text-slate-900">{executionMetrics.totalScheduled}</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-blue-600" />
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1">Generated Today</p>
                <div className="text-2xl font-bold text-slate-900">{executionMetrics.generatedToday}</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                <Activity className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1">Delivery Success</p>
                <div className="text-2xl font-bold text-slate-900">{executionMetrics.successRate}%</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-indigo-600" />
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-1">Failed Executions</p>
                <div className="text-2xl font-bold text-slate-900">{executionMetrics.failedExecutions}</div>
              </div>
              <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          {scheduledReports.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center">
              <Calendar className="w-12 h-12 text-slate-300 mb-4" />
              <h3 className="text-lg font-bold text-slate-900 mb-2">No Scheduled Reports</h3>
              <p className="text-slate-500 text-[14px]">Automate your workflow by scheduling reports to be delivered directly to your inbox.</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Report Name</th>
                  <th className="px-5 py-3 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Type & Format</th>
                  <th className="px-5 py-3 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Frequency</th>
                  <th className="px-5 py-3 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Next Run</th>
                  <th className="px-5 py-3 text-[12px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-[12px] font-bold text-slate-500 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scheduledReports.map(report => (
                  <tr key={report.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4 font-bold text-slate-900 text-[13px]">{report.name}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-slate-600">{report.type}</span>
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[11px] font-bold uppercase">{report.format}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 text-[13px] text-slate-600 font-medium">
                        <Clock className="w-3.5 h-3.5 text-slate-400" /> {report.frequency}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-[13px] text-slate-600">
                      {new Date(report.next_run_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3" /> {report.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded hover:bg-slate-100">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </div>
      )}

    </div>
  )
}
