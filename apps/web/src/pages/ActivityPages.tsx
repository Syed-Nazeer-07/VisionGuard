import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { Activity, Download, Film, ShieldAlert } from 'lucide-react';
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
  return <section className="vg-stat" aria-label={label}>
    <div className="vg-stat-label">{label}</div>
    <div className="vg-stat-value">{fmt(number)}</div>
    <div className="vg-stat-foot">{note}</div>
  </section>;
}

function distribution(records: AnalysisRecord[]) {
  return Object.entries(summarizeActivity(records).distribution)
    .map(([name, count]) => ({ name: title(name), count }))
    .sort((a,b) => b.count-a.count);
}

function RecentRuns({ records }: { records: AnalysisRecord[] }) {
  return <section className="vg-panel overflow-hidden">
    <div className="vg-section-head">
      <h2>Recent sessions</h2>
      <Link to="/app/videos">View history</Link>
    </div>
    {!records.length ? <p className="vg-empty-row">No sessions on record.</p> :
    <div className="divide-y divide-slate-100">
      {records.slice(0, 7).map(run =>
        <div key={run.id} className="flex items-center gap-4 px-5 py-3.5 text-sm">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Film size={17}/>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-slate-800">{run.sourceName}</div>
            <div className="mt-1 text-xs text-slate-500">{niceDate(run.updatedAt)} · {run.sourceType === 'live-stream' ? 'Live source' : 'Video'}</div>
          </div>
          <div className="text-right">
            <div className="font-semibold tabular-nums text-slate-900">{Object.keys(run.vehicles).length}</div>
            <div className="text-[11px] text-slate-500">vehicles</div>
          </div>
        </div>)}
    </div>}
  </section>;
}

export function ActivityDashboard() {
  const { records, loaded, stats, error } = useRuns();
  const data = distribution(records);
  return <main className="vg-page">
    <header className="vg-page-header">
      <div><h1>Overview</h1><p>Vehicle activity and analysis sessions</p></div>
      <Link to="/app/analyze" className="vg-primary"><Activity size={16}/> New analysis</Link>
    </header>
    {error && <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Unique tracked vehicles" number={stats.vehicles} note="Across recorded sessions"/>
      <Stat label="Analysis sessions" number={stats.runs} note="Videos and live sources"/>
      <Stat label="Inference frames" number={stats.analyzedFrames} note="Completed detector observations"/>
      <Stat label="Recorded incidents" number={stats.violations} note="Evidence-based records"/>
    </div>
    <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
      <RecentRuns records={records}/>
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head">
          <h2>Vehicle distribution</h2>
          <Link to="/app/analytics">Analytics</Link>
        </div>
        {!loaded ? <p className="vg-empty-row">Loading data…</p> :
          !data.length ? <p className="vg-empty-row">No vehicle classifications available.</p> :
          <div className="h-72 px-4 py-5">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid stroke="#eef1f5" horizontal={false}/>
                <XAxis type="number" allowDecimals={false} tick={{fontSize:11,fill:'#64748b'}} axisLine={false} tickLine={false}/>
                <YAxis type="category" dataKey="name" width={90} tick={{fontSize:11,fill:'#475569'}} axisLine={false} tickLine={false}/>
                <Tooltip cursor={{ fill: '#f5f8fb' }} />
                <Bar dataKey="count" name="Vehicles" fill="#3866a4" radius={[0,4,4,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>}
      </section>
    </div>
    <p className="vg-footnote">Figures reflect the detector's saved observations; estimated speeds are not verified offences.</p>
  </main>;
}

export function ActivityAnalytics() {
  const { records, loaded, error } = useRuns();
  const [range, setRange] = useState<'all'|'today'|'week'|'month'>('all');
  const filtered = useMemo(() => {
    const now = Date.now();
    const ms = range === 'today' ? 86400000 : range === 'week' ? 7*86400000 : range === 'month' ? 30*86400000 : Infinity;
    return records.filter(r => now-r.createdAt <= ms);
  }, [range, records]);
  const counts = useMemo(() => summarizeActivity(filtered), [filtered]);
  const byClass = distribution(filtered);
  return <main className="vg-page">
    <header className="vg-page-header">
      <div><h1>Analytics</h1><p>Vehicle classifications and detection volume</p></div>
      <select aria-label="Time range" value={range} onChange={e=>setRange(e.target.value as typeof range)}
        className="vg-field">
        <option value="all">All time</option>
        <option value="today">Last 24 hours</option>
        <option value="week">Last 7 days</option>
        <option value="month">Last 30 days</option>
      </select>
    </header>
    {error && <p role="alert" className="mb-4 text-sm text-amber-700">{error}</p>}
    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      <Stat label="Unique vehicles" number={counts.vehicles} note="Distinct tracks per session"/>
      <Stat label="Peak simultaneous tracks" number={counts.maximumVisible} note="Maximum detected in one frame"/>
      <Stat label="Inference frames" number={counts.analyzedFrames} note="Completed observations"/>
    </div>
    <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head"><h2>Classification breakdown</h2></div>
        {loaded && byClass.length ?
          <div className="h-72 p-5">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byClass} margin={{left: 4, right: 12, bottom: 0}}>
                <CartesianGrid stroke="#edf1f5" vertical={false}/>
                <XAxis dataKey="name" tick={{fontSize:11,fill:'#64748b'}} axisLine={false} tickLine={false}/>
                <YAxis allowDecimals={false} tick={{fontSize:11,fill:'#64748b'}} axisLine={false} tickLine={false}/>
                <Tooltip cursor={{fill:'#f5f8fb'}}/>
                <Bar dataKey="count" name="Vehicles" fill="#3866a4" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div> :
          <p className="vg-empty-row">{loaded ? 'No classification data for this period.' : 'Loading data…'}</p>}
      </section>
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head"><h2>Sessions in range</h2></div>
        {filtered.length ?
          <div className="divide-y divide-slate-100">
            {filtered.slice(0,12).map(run =>
              <div key={run.id} className="flex items-center justify-between gap-3 px-5 py-3.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{run.sourceName}</p>
                  <p className="mt-1 text-xs text-slate-500">{niceDate(run.createdAt)}</p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-slate-800">{Object.keys(run.vehicles).length}</span>
              </div>)}
          </div> : <p className="vg-empty-row">No sessions in the selected period.</p>}
      </section>
    </div>
    <p className="vg-footnote">These are detector observations. Estimated speeds are not included in confirmed violation totals.</p>
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
  const { records, loaded, error } = useRuns();
  const [selected, setSelected] = useState('all');
  const filtered = selected === 'all' ? records : records.filter(r=>r.id===selected);
  const totals = summarizeActivity(filtered);
  return <main className="vg-page">
    <header className="vg-page-header">
      <div><h1>Reports</h1><p>Export tracked activity by session</p></div>
    </header>
    {error && <p role="alert" className="mb-4 text-sm text-amber-700">{error}</p>}
    <section className="vg-panel overflow-hidden">
      <div className="vg-section-head"><h2>Export options</h2></div>
      <div className="p-5 sm:p-6">
        <label htmlFor="report-run" className="mb-2 block text-xs font-semibold text-slate-600">Select scope</label>
        <select id="report-run" value={selected} onChange={e=>setSelected(e.target.value)} className="vg-field w-full max-w-xl">
          <option value="all">All saved sessions</option>
          {records.map(r=><option key={r.id} value={r.id}>{r.sourceName} · {niceDate(r.createdAt)}</option>)}
        </select>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Stat label="Sessions" number={totals.runs} note="Included in report"/>
          <Stat label="Unique vehicles" number={totals.vehicles} note="Tracked objects"/>
          <Stat label="Recorded incidents" number={totals.violations} note="Evidence-backed events"/>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" disabled={!loaded || !filtered.length} onClick={()=>exportPDF(filtered)}
            className="vg-primary"><Download size={15}/> Download PDF</button>
          <button type="button" disabled={!loaded || !filtered.length} onClick={()=>exportCSV(filtered)}
            className="vg-secondary"><Download size={15}/> Download CSV</button>
        </div>
        <p className="vg-footnote">Reports use saved analysis records. Image-derived speeds are approximate and not valid enforcement measurements.</p>
      </div>
    </section>
  </main>;
}

interface B2VideoRow {
  id: string;
  filename: string;
  file_size: number | null;
  uploaded_at: string;
  storage_path: string | null;
  processing_status: string | null;
  metadata: Record<string, unknown> | null;
}

export function ActivityVideoLibrary() {
  const { records, loaded, error, userId } = useRuns();
  const [b2Videos, setB2Videos] = useState<B2VideoRow[]>([]);
  const [b2Loading, setB2Loading] = useState(false);
  const [b2Error, setB2Error] = useState('');
  useEffect(() => {
    if (!userId) { setB2Videos([]); return; }
    let alive = true;
    setB2Loading(true);
    void (async () => {
      const { data, error: queryError } = await (supabase as any)
        .from('video_assets')
        .select('id,filename,file_size,uploaded_at,storage_path,processing_status,metadata')
        .eq('uploaded_by',userId)
        .eq('storage_provider','b2')
        .order('uploaded_at',{ascending:false}).limit(50);
      if (!alive) return;
      if (queryError) setB2Error(queryError.message);
      else { setB2Error(''); setB2Videos((data||[]) as B2VideoRow[]); }
      setB2Loading(false);
    })().catch(e => { if(alive) {setB2Loading(false);setB2Error(String(e));} });
    return () => { alive = false; };
  },[userId]);
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">Analysis history</h1>
        <p className="mt-1 text-sm text-slate-500">Saved tracking sessions for videos and live sources</p>
      </div>
      <Link to="/app/analyze" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
        Open analysis
      </Link>
    </div>
    
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4">
        <div><h2 className="font-semibold text-slate-900">Saved videos · Backblaze B2</h2>
          <p className="mt-1 text-xs text-slate-500">Only files you chose to upload. The list is metadata; the video bytes stay in B2.</p>
        </div>
        <Link className="text-xs font-semibold text-indigo-600 hover:underline" to="/app/archive-videos">Manage cloud videos</Link>
      </div>
      {b2Error && <p role="alert" className="p-4 text-xs text-amber-700">Could not load B2 file list: {b2Error}</p>}
      {b2Loading ? <p className="p-4 text-sm text-slate-500">Loading B2 video records…</p> :
        !b2Videos.length ? <p className="p-4 text-sm text-slate-500">No B2 uploads found for this account.</p> :
        b2Videos.map(video=><div key={video.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4 last:border-0">
          <Film size={19} className="text-indigo-500"/>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800">{video.filename}</div>
            <div className="text-xs text-slate-500">{new Date(video.uploaded_at).toLocaleString()}
              {video.file_size ? ' · '+(video.file_size/1048576).toFixed(1)+' MB' : ''}</div>
          </div>
          <span className="text-xs text-slate-600">{video.storage_path ? 'Stored in B2' :
            video.processing_status === 'failed' ? 'Upload failed' : 'Upload pending'}</span>
          <Link to={'/app/archive-videos?video='+encodeURIComponent(video.id)}
            className="text-xs font-semibold text-indigo-600 hover:underline">Open</Link>
        </div>)}
    </section>
    {error && <p role="alert" className="text-sm text-amber-700">{error}</p>}
    {!loaded ? <p className="text-sm text-slate-500">Restoring activity history…</p> :
      !records.length ? <p className="vg-empty-row">No session records available.</p> :
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {records.map(run=><div key={run.id} className="flex flex-wrap items-center gap-4 border-b border-slate-100 p-4 last:border-0">
          <Film size={20} className="text-indigo-500"/>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-slate-800">{run.sourceName}</p>
            <p className="mt-1 text-xs text-slate-500">{niceDate(run.createdAt)} · {run.sourceType==='live-stream'?'Live stream':'Uploaded video'}</p>
          </div>
          <div className="text-right text-sm">
            <strong className="tabular-nums">{Object.keys(run.vehicles).length} unique vehicles</strong>
            <p className="text-xs text-slate-500">{run.analyzedFrames} analyzed frames</p>
          </div>
        </div>)}
      </div>}
    <p className="text-xs text-slate-500">An analysis record does not imply its source video was saved. Retaining footage is an independent opt-in inside Live Analysis.</p>
  </main>;
}

export function ActivityIncidents() {
  const { records, loaded, error } = useRuns();
  const incidents = records.flatMap(run=>run.violations.map(event=>({ run, event })))
    .sort((a,b)=>b.event.observedAt-a.event.observedAt);
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold text-slate-900">Incidents and violations</h1>
      <p className="mt-1 text-sm text-slate-500">Evidence-backed records only — no fabricated overspeed findings</p>
    </div>
    
    <p className="text-xs text-slate-600">Older cloud incidents and case reviews are kept separately:
      <Link className="ml-1 font-semibold text-indigo-600 hover:underline" to="/app/archive-cases">Open legacy cases</Link>.
    </p>
    {error && <p role="alert" className="text-sm text-amber-700">{error}</p>}
    {!loaded ? <p className="text-sm text-slate-500">Restoring incident history…</p> :
      !incidents.length ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <ShieldAlert className="mx-auto text-indigo-400" size={30}/>
        <h2 className="mt-3 font-semibold text-slate-900">No verified incidents recorded</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          Analysis identifies vehicles, but uncalibrated speed estimates do not establish a violation.
          Verified events will appear here when supported by actual evidence.
        </p>
      </div> :
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {incidents.map(({run,event})=><div key={event.id} className="border-b border-slate-100 p-4 text-sm last:border-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-slate-900">{title(event.type)}</strong>
            <span className="text-xs font-semibold text-slate-600">{event.status.replace('_',' ')}</span>
          </div>
          <p className="mt-1 text-slate-600">{run.sourceName} · Track #{event.trackId??'N/A'}</p>
          <p className="mt-1 text-xs text-slate-500">{event.evidenceNote}</p>
        </div>)}
      </div>}
  </main>;
}
