import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowRight, BarChart3, Car, Download, FileText, Film, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuthStore } from '../store/auth';
import { summarizeActivity, useActivityLedger, type AnalysisRecord } from '../services/activityLedger';

const niceDate = (time: number) => new Date(time).toLocaleString();
const fmt = (n: number) => n.toLocaleString();
const title = (value: string) => value.replace(/(^|[-_\s])\w/g, s => s.toUpperCase());

function useRuns() {
  const userId = useAuthStore(s => s.user?.id ?? null);
  const data = useActivityLedger(userId);
  const stats = useMemo(() => summarizeActivity(data.records), [data.records]);
  return { ...data, stats, userId };
}

function Stat({ label, number, note }: { label: string; number: number; note: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="text-sm font-medium text-slate-500">{label}</div>
    <div className="mt-2 text-3xl font-bold tabular-nums text-slate-900">{fmt(number)}</div>
    <div className="mt-2 text-xs text-slate-500">{note}</div>
  </div>;
}

function LocalScope() {
  return <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-900">
    <strong>Saved on this device.</strong> Vehicle history survives page changes and browser restarts, but it is not a cloud backup.
    Clearing browser site data or switching devices can erase it. Confirmed violations appear only when evidence is recorded.
  </div>;
}

function EmptyState() {
  return <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
    <Activity className="mx-auto mb-3 text-indigo-400" size={30}/>
    <h3 className="font-semibold text-slate-900">No analysis activity recorded yet</h3>
    <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
      Play a traffic video in Live Analysis. Each new vehicle ID and its class will be saved automatically.
    </p>
    <Link to="/app/analyze" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
      Open Live Analysis <ArrowRight size={14}/>
    </Link>
  </div>;
}

function distribution(records: AnalysisRecord[]) {
  return Object.entries(summarizeActivity(records).distribution)
    .map(([name, count]) => ({ name: title(name), count }))
    .sort((a,b) => b.count-a.count);
}

function RecentRuns({ records }: { records: AnalysisRecord[] }) {
  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <div className="border-b border-slate-100 p-4 font-semibold text-slate-900">Recent analysis sessions</div>
    {records.slice(0,8).map(run => <div key={run.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-0">
      <Film size={17} className="text-indigo-500" />
      <div className="min-w-0 flex-1"><div className="truncate font-medium text-slate-800">{run.sourceName}</div>
        <div className="text-xs text-slate-500">{niceDate(run.updatedAt)} · {run.sourceType === 'live-stream' ? 'Stream' : 'Video'}</div>
      </div>
      <div className="text-right"><div className="font-semibold tabular-nums">{Object.keys(run.vehicles).length} vehicles</div>
        <div className="text-xs text-slate-500">{run.analyzedFrames} inference frames</div>
      </div>
    </div>)}
  </div>;
}

export function ActivityDashboard() {
  const { records, loaded, stats, error } = useRuns();
  return <main className="mx-auto max-w-6xl space-y-5 px-3 py-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Overview</h1>
      <p className="mt-1 text-sm text-slate-500">Live vehicle analysis and saved local activity</p>
    </div><Link to="/app/analyze" className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"><Activity size={16}/> Analyze traffic</Link></div>
    <LocalScope/>
    {error && <div role="alert" className="text-sm text-amber-700">Storage warning: {error}</div>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Tracked vehicles" number={stats.vehicles} note="Unique track IDs across sessions"/>
      <Stat label="Analysis sessions" number={stats.runs} note="Uploaded videos and streams"/>
      <Stat label="Analyzed frames" number={stats.analyzedFrames} note="YOLO inference observations"/>
      <Stat label="Recorded violations" number={stats.violations} note="Evidence-backed events only"/>
    </div>
    {!loaded ? <p className="text-sm text-slate-500">Restoring saved activity…</p> : !records.length ? <EmptyState/> :
      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <RecentRuns records={records}/>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 font-semibold text-slate-900">Vehicle classes</div>
          <div className="h-64"><ResponsiveContainer width="100%" height="100%">
            <BarChart data={distribution(records)} layout="vertical" margin={{ left: 13, right: 14 }}>
              <CartesianGrid strokeDasharray="2 4" horizontal={false}/>
              <XAxis type="number" allowDecimals={false}/>
              <YAxis type="category" dataKey="name" width={85} tick={{ fontSize: 12 }}/>
              <Tooltip/><Bar dataKey="count" name="Unique vehicles" fill="#4f46e5" radius={[0,5,5,0]}/>
            </BarChart>
          </ResponsiveContainer></div>
        </div>
      </div>}
    <div className="grid gap-3 sm:grid-cols-2">
      <Link to="/app/analytics" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800"><span className="flex items-center gap-2"><BarChart3 size={17} className="text-indigo-500"/> Detailed analytics</span><ArrowRight size={16}/></Link>
      <Link to="/app/reports" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-800"><span className="flex items-center gap-2"><FileText size={17} className="text-indigo-500"/> Export reports</span><ArrowRight size={16}/></Link>
    </div>
  </main>;
}

export function ActivityAnalytics() {
  const { records, loaded, stats, error } = useRuns();
  const [range, setRange] = useState<'all'|'today'|'week'|'month'>('all');
  const filtered = useMemo(() => {
    const now = Date.now();
    const ms = range === 'today' ? 86400000 : range === 'week' ? 7*86400000 : range === 'month' ? 30*86400000 : Infinity;
    return records.filter(r => now-r.createdAt <= ms);
  }, [range, records]);
  const counts = useMemo(() => summarizeActivity(filtered), [filtered]);
  const byClass = distribution(filtered);
  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><div>
      <h1 className="text-2xl font-bold text-slate-900">Traffic analytics</h1>
      <p className="mt-1 text-sm text-slate-500">Measured detections, unique tracks and trends from your saved sessions</p>
    </div><select aria-label="Time range" value={range} onChange={e=>setRange(e.target.value as typeof range)}
      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
      <option value="all">All time</option><option value="today">Past 24 hours</option>
      <option value="week">Past 7 days</option><option value="month">Past 30 days</option>
    </select></div>
    <LocalScope/>
    {error && <p className="text-sm text-amber-800">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat label="Unique vehicles" number={counts.vehicles} note="Not repeated per frame"/>
      <Stat label="Maximum vehicles in frame" number={counts.maximumVisible} note="Peak simultaneous tracks"/>
      <Stat label="Actual inference frames" number={counts.analyzedFrames} note="Completed YOLO observations"/>
    </div>
    {loaded && filtered.length ? <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 font-semibold text-slate-900">Vehicle classification</h2>
        <div className="h-72"><ResponsiveContainer width="100%" height="100%">
          <BarChart data={byClass}><CartesianGrid strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="name" tick={{ fontSize: 11 }}/><YAxis allowDecimals={false}/>
            <Tooltip/><Bar dataKey="count" name="Vehicles" fill="#4f46e5" radius={[5,5,0,0]}/></BarChart>
        </ResponsiveContainer></div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-4 font-semibold text-slate-900">Sessions</h2>
        {filtered.slice(0,10).map(run => <div key={run.id} className="flex justify-between gap-3 border-b border-slate-100 py-3 text-sm last:border-0">
          <span className="min-w-0 truncate text-slate-700">{run.sourceName}</span>
          <strong className="shrink-0 tabular-nums">{Object.keys(run.vehicles).length} vehicles</strong>
        </div>)}
      </div>
    </div> : loaded ? <EmptyState/> : <p className="text-sm text-slate-500">Loading analytics…</p>}
    <p className="text-xs text-slate-500">Counts represent detected tracked objects, not confirmed traffic violations. Approximate speed readings are excluded from violation totals.</p>
  </main>;
}

function csvCell(value: unknown) {
  const string = String(value ?? '');
  // Prevent spreadsheet formula injection when users open exported CSV files.
  const safe = /^[=+@-]/.test(string) && /[^0-9.]/.test(string.slice(1)) ? "'" + string : string;
  return '"' + safe.replace(/"/g,'""') + '"';
}
function exportCSV(records: AnalysisRecord[]) {
  const columns = ['Session','Source','Date','Track ID','Vehicle class','Confidence','First seen (s)','Last seen (s)','Estimated km/h'];
  const rows = records.flatMap(run => Object.values(run.vehicles).map(t => [
    run.id,run.sourceName,new Date(run.createdAt).toISOString(),t.id,t.type,
    t.confidence.toFixed(3),t.firstSeenAt.toFixed(2),t.lastSeenAt.toFixed(2),
    t.estimatedSpeedKmh === null ? '' : t.estimatedSpeedKmh.toFixed(1)
  ]));
  const csv = '\uFEFF'+[columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  link.href=url;link.download='VisionGuard-vehicle-report.csv';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function exportPDF(records: AnalysisRecord[]) {
  const data = summarizeActivity(records);
  const pdf = new jsPDF();
  pdf.setFont('helvetica','bold');pdf.setFontSize(18);pdf.text('VisionGuard | Traffic activity',14,20);
  pdf.setFont('helvetica','normal');pdf.setFontSize(10);
  pdf.text('Exported '+new Date().toLocaleString(),14,29);
  pdf.text('Local device activity. Speeds are approximate and not enforcement evidence.',14,36);
  pdf.text('Sessions: '+data.runs+'  |  Unique vehicles: '+data.vehicles+'  |  Verified violations: '+data.violations,14,45);
  const rows = records.flatMap(run=>Object.values(run.vehicles).map(v=>[
    run.sourceName.slice(0,32),String(v.id),v.type,
    String(Math.round(v.confidence*100))+'%',
    v.estimatedSpeedKmh===null?'N/A':'~'+Math.round(v.estimatedSpeedKmh)
  ]));
  autoTable(pdf,{
    startY:54,head:[['Video/stream','Track','Class','Confidence','Est. km/h']],
    body:rows,theme:'striped',styles:{fontSize:8},headStyles:{fillColor:[67,56,202]},
  });
  pdf.save('VisionGuard-activity-report.pdf');
}

export function ActivityReports() {
  const { records, loaded, stats, error } = useRuns();
  const [selected, setSelected] = useState('all');
  const filtered = selected === 'all' ? records : records.filter(r=>r.id===selected);
  const totals = summarizeActivity(filtered);
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold text-slate-900">Reports</h1>
      <p className="mt-1 text-sm text-slate-500">Export your actual tracked activity without unnecessary forms or fabricated incidents</p>
    </div>
    <LocalScope/>
    {error && <p role="alert" className="text-amber-700">{error}</p>}
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <label htmlFor="report-run" className="mb-2 block text-sm font-semibold text-slate-800">Analysis session</label>
      <select id="report-run" value={selected} onChange={e=>setSelected(e.target.value)}
        className="w-full rounded-lg border border-slate-200 p-3 text-sm">
        <option value="all">All saved sessions</option>
        {records.map(r=><option key={r.id} value={r.id}>{r.sourceName} · {niceDate(r.createdAt)}</option>)}
      </select>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Sessions" number={totals.runs} note="Selected scope"/>
        <Stat label="Unique vehicles" number={totals.vehicles} note="Per-session unique tracks"/>
        <Stat label="Recorded violations" number={totals.violations} note="Evidence-backed, not estimated"/>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" disabled={!loaded||!filtered.length} onClick={()=>exportPDF(filtered)}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          <Download size={16}/> Export PDF
        </button>
        <button type="button" disabled={!loaded||!filtered.length} onClick={()=>exportCSV(filtered)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40">
          <Download size={16}/> Export CSV
        </button>
      </div>
    </div>
    {!records.length && loaded && <EmptyState/>}
    {records.length>0 && <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
      <strong className="text-slate-900">Report integrity</strong>
      <p className="mt-1">Only detected track records are exported. The speed column is explicitly approximate;
        no overspeed or safety violation is inferred without calibrated measurements or verified evidence.</p>
    </div>}
  </main>;
}
