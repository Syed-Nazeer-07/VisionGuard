import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { localAnalysisStorage } from '../services/localAnalysisStorage';
import { Link } from 'react-router-dom';
import { Download, Film, Plus, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useAuthStore } from '../store/auth';
import { activityLedger, summarizeActivity, useActivityLedger, type AnalysisRecord, type ViolationRecord } from '../services/activityLedger';
import { csvCell } from '../services/csvExport';
import { groupIncidentRecords, incidentLabel, manualIncidentEvidence } from '../services/incidentPresentation';

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
    </header>
    {error && <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Unique tracked vehicles" number={stats.vehicles} note="Across recorded sessions"/>
      <Stat label="Analysis sessions" number={stats.runs} note="Videos and live sources"/>
      <Stat label="Inference frames" number={stats.analyzedFrames} note="Completed detector observations"/>
      <Stat label="Review flags" number={stats.violations} note="Awaiting evidence verification"/>
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
  // Keep filter calculations pure during render.
  const [asOf, setAsOf] = useState(Date.now);
  useEffect(() => {
    // An always-open dashboard must not freeze "last 24 hours" at mount time.
    const timer = window.setInterval(() => setAsOf(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const filtered = useMemo(() => {
    const now = asOf;
    const ms = range === 'today' ? 86400000 : range === 'week' ? 7*86400000 : range === 'month' ? 30*86400000 : Infinity;
    // Activity is grouped by when the session was last analyzed, not when a
    // long-running live stream was first opened yesterday.
    return records.filter(r => now - r.updatedAt <= ms);
  }, [range, records, asOf]);
  const counts = useMemo(() => summarizeActivity(filtered), [filtered]);
  const byClass = distribution(filtered);
  return <main className="vg-page">
    <header className="vg-page-header">
      <div><h1>Analytics</h1><p>Vehicle classifications and detection volume</p></div>
      <select aria-label="Time range" value={range} onChange={e=>{
        setAsOf(Date.now());
        setRange(e.target.value as typeof range);
      }}
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
  pdf.text('Sessions: '+data.runs+'  |  Tracked vehicles: '+data.vehicles+'  |  Review flags: '+data.violations,14,45);
  const rows = records.flatMap(run=>Object.values(run.vehicles).map(v=>[
    run.sourceName.slice(0,32),String(v.id),v.type,
    String(Math.round(v.confidence*100))+'%',
    v.estimatedSpeedKmh===null?'N/A':'~'+Math.round(v.estimatedSpeedKmh)
  ]));
  autoTable(pdf,{
    startY:54,head:[['Video/stream','Track','Class','Confidence','Est. km/h']],
    body:rows,theme:'striped',styles:{fontSize:8},headStyles:{fillColor:[67,56,202]},
  });
  const flags = records.flatMap(run => run.violations.map(flag => [
    run.sourceName.slice(0,25),
    flag.trackId == null ? '—' : String(flag.trackId),
    title(flag.type),
    flag.status.replace('_',' '),
    flag.evidenceNote.slice(0,160)
  ]));
  if (flags.length) {
    const previousTableEnd = (pdf as jsPDF & {lastAutoTable?: {finalY: number}})
      .lastAutoTable?.finalY ?? 54;
    autoTable(pdf,{
      startY: previousTableEnd + 12,
      head:[['Session','Track','Review reason','Status','Reviewer note']],
      body:flags, theme:'striped', styles:{fontSize:7},
      headStyles:{fillColor:[36,67,112]},
      columnStyles:{4:{cellWidth:60}}
    });
  }
  pdf.save('VisionGuard-activity-report.pdf');
}

function exportIncidentsCSV(records: AnalysisRecord[]) {
  const columns = ['Session','Source','Flag ID','Track ID','Review reason','Status','Observed at','Reviewer note'];
  const rows = records.flatMap(run => run.violations.map(event => [
    run.id, run.sourceName, event.id, event.trackId ?? '', event.type,
    event.status, new Date(event.observedAt).toISOString(), event.evidenceNote
  ]));
  const csv = '\uFEFF'+[columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href=url;link.download='VisionGuard-incident-review-flags.csv';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
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
          <Stat label="Review flags" number={totals.violations} note="Require human verification"/>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" disabled={!loaded || !filtered.length} onClick={()=>exportPDF(filtered)}
            className="vg-primary"><Download size={15}/> Download PDF</button>
          <button type="button" disabled={!loaded || !filtered.length} onClick={()=>exportCSV(filtered)}
            className="vg-secondary"><Download size={15}/> Vehicle CSV</button>
          <button type="button" disabled={!loaded || !filtered.some(r=>r.violations.length)}
            onClick={()=>exportIncidentsCSV(filtered)}
            className="vg-secondary"><Download size={15}/> Incident review CSV</button>
        </div>
        <p className="vg-footnote">PDF includes tracked vehicles and any saved review flags. Vehicle CSV contains tracks; incident CSV contains review flags. Image-derived speeds are approximate, not enforcement measurements.</p>
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
  const [localVideo, setLocalVideo] = useState<{name:string;size:number}|null>(null);
  const [localError, setLocalError] = useState('');
  const [b2Loading, setB2Loading] = useState(false);
  const [b2Error, setB2Error] = useState('');
  useEffect(() => {
    if (!userId) { setLocalVideo(null); setLocalError(''); return; }
    let alive = true;
    void localAnalysisStorage.loadVideo(userId).then(saved => {
      if (!alive) return;
      setLocalError('');
      setLocalVideo(saved ? {name:saved.name,size:saved.file.size} : null);
    }).catch(error => {
      if (!alive) return;
      setLocalVideo(null);
      setLocalError('Could not access the retained local file: ' +
        (error instanceof Error ? error.message : String(error)));
    });
    return () => { alive = false; };
  }, [userId]);
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
  return <main className="vg-page">
    <header className="vg-page-header">
      <div><h1>History</h1><p>Analyzed sessions and retained footage</p></div>
    </header>
    {error && <p role="alert" className="mb-4 text-sm text-amber-700">{error}</p>}
    <div className="space-y-5">
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head">
          <h2>On this device</h2>
          <Link to="/app/analyze">Video analysis</Link>
        </div>
        {localError && <p role="alert" className="vg-empty-row text-amber-700">{localError}</p>}
        {!localError && !localVideo && <p className="vg-empty-row">No local recording retained for this account.</p>}
        {localVideo && <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Film size={17}/>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">{localVideo.name}</p>
            <p className="mt-1 text-xs text-slate-500">Local only · {(localVideo.size/1048576).toFixed(1)} MB · Not uploaded to cloud</p>
          </div>
          <Link to="/app/analyze" className="text-xs font-semibold text-[#2356a8] hover:underline">Resume analysis</Link>
        </div>}
      </section>
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head">
          <h2>Video storage · Backblaze B2</h2>
          <Link to="/app/archive-videos">Manage storage</Link>
        </div>
        {b2Error && <p role="alert" className="p-4 text-sm text-amber-700">{b2Error}</p>}
        {b2Loading ? <p className="vg-empty-row">Loading video records…</p> :
          !b2Videos.length ? <p className="vg-empty-row">No videos stored in B2.</p> :
          <div className="divide-y divide-slate-100">
            {b2Videos.map(video =>
              <div key={video.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <Film size={17}/>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{video.filename}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(video.uploaded_at).toLocaleString()}
                    {video.file_size ? ' · '+(video.file_size/1048576).toFixed(1)+' MB' : ''}</p>
                </div>
                <span className="text-xs text-slate-500">{video.storage_path ? 'Stored' :
                  video.processing_status === 'failed' ? 'Failed' : 'Pending'}</span>
                <Link to={'/app/archive-videos?video='+encodeURIComponent(video.id)}
                  className="text-xs font-semibold text-[#2356a8] hover:underline">Details</Link>
              </div>)}
          </div>}
      </section>
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head"><h2>Analysis sessions</h2><span className="text-xs text-slate-500">{records.length} total</span></div>
        {!loaded ? <p className="vg-empty-row">Loading session history…</p> :
          !records.length ? <p className="vg-empty-row">No sessions on record.</p> :
          <div className="divide-y divide-slate-100">
            {records.map(run =>
              <div key={run.id} className="flex items-center gap-4 px-5 py-3.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-800">{run.sourceName}</div>
                  <div className="mt-1 text-xs text-slate-500">{niceDate(run.createdAt)} · {run.sourceType==='live-stream'?'Live source':'Video'}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums text-slate-800">{Object.keys(run.vehicles).length}</div>
                  <div className="text-[11px] text-slate-500">vehicles</div>
                </div>
              </div>)}
          </div>}
      </section>
    </div>
    <p className="vg-footnote">Analysis records are retained separately from source video files. Saving a session does not upload its footage.</p>
  </main>;
}

function IncidentRow({ run, event }: { run: AnalysisRecord; event: ViolationRecord }) {
  const automatic = event.id.startsWith('auto:');
  return <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 text-sm">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-slate-800">{incidentLabel(event.type)}</p>
        <span className={automatic
          ? 'rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700'
          : 'rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600'}>
          {automatic ? 'Automatic' : 'Manual'}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {run.sourceName} · {event.trackId === null ? 'No vehicle selected' : 'Vehicle #' + event.trackId}
        {' · ' + niceDate(event.observedAt)}
      </p>
      <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-600" title={event.evidenceNote}>
        {event.evidenceNote}
      </p>
    </div>
    <span className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium capitalize text-amber-900">
      {event.status.replace('_', ' ')}
    </span>
  </div>;
}

export function ActivityIncidents() {
  const { records, loaded, error, userId } = useRuns();
  const [manualOpen, setManualOpen] = useState(false);
  const [runId, setRunId] = useState('');
  const [trackId, setTrackId] = useState('');
  const [flagType, setFlagType] = useState<'speed_estimate_review' | 'observed_event'>('observed_event');
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState('');
  const run = records.find(r => r.id === runId) ?? records[0];
  const tracks = run ? Object.values(run.vehicles).sort((a, b) => a.id - b.id) : [];
  const chosenTrack = tracks.find(t => String(t.id) === trackId);
  const { automatic, manual } = groupIncidentRecords(records);

  const submitFlag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback('');
    if (!loaded || !userId || !run) {
      setFeedback('Analyze a video first.');
      return;
    }
    if (flagType === 'speed_estimate_review' && !chosenTrack) {
      setFeedback('Select a vehicle for speed review.');
      return;
    }
    const record: ViolationRecord = {
      id: crypto.randomUUID(),
      trackId: chosenTrack?.id ?? null,
      type: flagType,
      observedAt: Date.now(),
      status: 'pending_review',
      evidenceNote: manualIncidentEvidence(flagType, note, chosenTrack?.estimatedSpeedKmh ?? null),
    };
    activityLedger.addReviewedViolation(userId, run.id, record);
    void activityLedger.flush(userId).catch(console.warn);
    setNote('');
    setTrackId('');
    setManualOpen(false);
    setFeedback('Incident saved for review.');
  };

  return <main className="vg-page">
    <header className="vg-page-header">
      <div>
        <h1>Incidents</h1>
        <p>Automatic observations · review required</p>
      </div>
      <button type="button"
        aria-controls="manual-incident-form" aria-expanded={manualOpen}
        onClick={() => { setManualOpen(value => !value); setFeedback(''); }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50">
        {manualOpen ? <X size={15}/> : <Plus size={15}/>}
        {manualOpen ? 'Close' : 'Add incident'}
      </button>
    </header>
    {error && <p role="alert" className="mb-4 text-sm text-amber-700">{error}</p>}
    {feedback && <p role="status" className="mb-4 text-xs text-slate-600">{feedback}</p>}

    {manualOpen && <section id="manual-incident-form" className="vg-panel mb-5 overflow-hidden">
      <div className="vg-section-head"><h2>Add incident for review</h2></div>
      <form onSubmit={submitFlag} className="space-y-3 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="flag-session" className="mb-1 block text-xs font-semibold text-slate-700">Session</label>
            <select id="flag-session" className="vg-field w-full" value={run?.id ?? ''}
              onChange={event => { setRunId(event.target.value); setTrackId(''); }} disabled={!records.length}>
              {records.length ? records.map(item =>
                <option key={item.id} value={item.id}>{item.sourceName} · {niceDate(item.createdAt)}</option>) :
                <option value="">No sessions yet</option>}
            </select>
          </div>
          <div>
            <label htmlFor="flag-type" className="mb-1 block text-xs font-semibold text-slate-700">Reason</label>
            <select id="flag-type" className="vg-field w-full" value={flagType}
              onChange={event => setFlagType(event.target.value as typeof flagType)}>
              <option value="observed_event">Other observation</option>
              <option value="speed_estimate_review">Possible speeding</option>
            </select>
          </div>
          <div>
            <label htmlFor="flag-track" className="mb-1 block text-xs font-semibold text-slate-700">
              Vehicle {flagType === 'observed_event' ? '(optional)' : ''}
            </label>
            <select id="flag-track" className="vg-field w-full" value={trackId}
              onChange={event => setTrackId(event.target.value)}>
              <option value="">Select a vehicle</option>
              {tracks.map(track =>
                <option key={track.id} value={String(track.id)}>
                  #{track.id} · {track.type}
                  {track.estimatedSpeedKmh === null ? '' : ' · ≈' + Math.round(track.estimatedSpeedKmh) + ' km/h'}
                </option>)}
            </select>
          </div>
          <div>
            <label htmlFor="flag-note" className="mb-1 block text-xs font-semibold text-slate-700">Note (optional)</label>
            <input id="flag-note" className="vg-field w-full" value={note} maxLength={160}
              onChange={event => setNote(event.target.value)}
              placeholder="e.g. Sudden lane change"/>
          </div>
        </div>
        {!records.length && <p className="text-xs text-slate-500">Analyze a video before adding incidents.</p>}
        <button type="submit" className="vg-primary" disabled={!loaded || !run || !userId}>
          Save incident
        </button>
      </form>
    </section>}

    <section className="vg-panel overflow-hidden">
      <div className="vg-section-head">
        <h2>Automatic detections</h2>
        <span className="text-xs tabular-nums text-slate-500">{automatic.length}</span>
      </div>
      {!loaded ? <p className="vg-empty-row">Loading incidents…</p> :
        !automatic.length ? <p className="vg-empty-row">No automatic incidents recorded yet.</p> :
        <div className="divide-y divide-slate-100">
          {automatic.map(({ run: item, event }) =>
            <IncidentRow key={item.id + ':' + event.id} run={item} event={event}/>)}
        </div>}
    </section>

    {!!manual.length && <section className="vg-panel mt-4 overflow-hidden">
      <div className="vg-section-head">
        <h2>Manual incidents</h2>
        <span className="text-xs tabular-nums text-slate-500">{manual.length}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {manual.map(({ run: item, event }) =>
          <IncidentRow key={item.id + ':' + event.id} run={item} event={event}/>)}
      </div>
    </section>}
    <p className="vg-footnote">Detected patterns are review flags, not confirmed violations.</p>
  </main>;
}
