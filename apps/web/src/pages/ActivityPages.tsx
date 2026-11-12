import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { localAnalysisStorage } from '../services/localAnalysisStorage';
import { describeCloudVideoFailure } from '../services/cloudVideoFeedback';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Download, Film, Plus, Search, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { jsPDF } from 'jspdf';
import { useAuthStore } from '../store/auth';
import { activityLedger, countRepeatedTracks, isRepeatedVehicleTrack, summarizeActivity, useActivityLedger, type AnalysisRecord, type ViolationRecord } from '../services/activityLedger';
import { csvCell } from '../services/csvExport';
import { groupIncidentRecords, incidentLabel, incidentReviewLabel, manualIncidentEvidence } from '../services/incidentPresentation';

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

function RecentRuns({ records, loaded }: { records: AnalysisRecord[]; loaded: boolean }) {
  return <section className="vg-panel overflow-hidden">
    <div className="vg-section-head">
      <h2>Recent sessions</h2>
      <Link to="/app/videos">View history</Link>
    </div>
    {!loaded ? <p role="status" className="vg-empty-row">Loading saved sessions…</p> :
      !records.length ? <div className="vg-empty-state">
        <strong>Your session history starts here.</strong>
        Analyze footage to build a searchable history of vehicle observations.
        <Link to="/app/analyze">Start your first analysis</Link>
      </div> :
    <div className="divide-y divide-slate-100">
      {records.slice(0, 7).map(run =>
        <div key={run.id} className="vg-run-row flex items-center gap-4 px-5 py-3.5 text-sm">
          <div className="vg-run-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
            <Film size={17}/>
          </div>
          <div className="min-w-0 flex-1">
            <div className="vg-run-name truncate">{run.sourceName}</div>
            <div className="vg-run-meta mt-1">{niceDate(run.updatedAt)} · {run.sourceType === 'live-stream' ? 'Live source' : 'Video'}</div>
          </div>
          <div className="text-right">
            <div className="vg-run-count tabular-nums">{countRepeatedTracks(run)}</div>
            <div className="text-[11px] text-slate-500">vehicles</div>
          </div>
        </div>)}
    </div>}
  </section>;
}

export function ActivityDashboard() {
  const { records, loaded, stats, error } = useRuns();
  const data = distribution(records);
  const mostRecent = records.reduce((latest, run) => Math.max(latest, run.updatedAt), 0);
  return <main className="vg-page">
    <header className="vg-dashboard-hero">
      <div>
        <div className="vg-dashboard-kicker">VISIONGUARD / OPERATIONS OVERVIEW</div>
        <h1>Every observation, in focus.</h1>
        <p>Your traffic intelligence workspace. Revisit analyzed footage, review vehicle activity, and follow up on observations with context.</p>
      </div>
      <div className="vg-dashboard-hero-side">
        <Link to="/app/analyze" className="vg-dashboard-action">
          Start an analysis <ArrowUpRight size={17} aria-hidden="true"/>
        </Link>
        <span className="vg-dashboard-last-activity">
          {!loaded ? 'Loading workspace…' : mostRecent > 0
            ? 'Last analyzed · ' + niceDate(mostRecent)
            : 'No analysis sessions saved yet'}
        </span>
      </div>
    </header>
    {error && <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    <div className="vg-metric-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Repeated vehicle tracks" number={stats.vehicles}
        note={stats.transientTrackCandidates + ' brief/noisy candidates excluded'}/>
      <Stat label="Analysis sessions" number={stats.runs} note="Videos and live sources"/>
      <Stat label="Inference frames" number={stats.analyzedFrames} note="Completed detector observations"/>
      <Stat label="Review flags" number={stats.violations}
        note={stats.pendingReviews + ' pending · ' +
          (stats.reviewedFlags + stats.dismissedFlags) + ' handled'}/>
    </div>
    <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
      <RecentRuns records={records} loaded={loaded}/>
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head">
          <h2>Vehicle distribution</h2>
          <Link to="/app/analytics">Analytics</Link>
        </div>
        {!loaded ? <p className="vg-empty-row">Loading data…</p> :
          !data.length ? <div className="vg-empty-state">
            <strong>Nothing to chart yet.</strong>
            Detected vehicle classes will appear after you analyze a source.
            <Link to="/app/analyze">Analyze footage</Link>
          </div> :
          <div className="h-72 px-4 py-5">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid stroke="#eef1f5" horizontal={false}/>
                <XAxis type="number" allowDecimals={false} tick={{fontSize:11,fill:'#64748b'}} axisLine={false} tickLine={false}/>
                <YAxis type="category" dataKey="name" width={90} tick={{fontSize:11,fill:'#475569'}} axisLine={false} tickLine={false}/>
                <Tooltip cursor={{ fill: '#f5f8fb' }} />
                <Bar dataKey="count" name="Vehicles" fill="#567e8e" radius={[0,5,5,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>}
      </section>
    </div>
    <p className="vg-footnote">Counts exclude fleeting track IDs but can still include duplicates after occlusion. Speed readings are uncalibrated optical proxies.</p>
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
  return <main className="vg-page vg-data-page">
    <header className="vg-page-header">
      <div><span className="vg-page-kicker">DATA EXPLORER / OBSERVATIONS</span><h1>Analytics</h1><p>Understand vehicle classes, activity volume and session history.</p></div>
      <div role="group" aria-label="Analytics time range" className="vg-range-control">
        {([
          ['all', 'All time'], ['today', '24 hours'], ['week', '7 days'], ['month', '30 days'],
        ] as const).map(([value, label]) =>
          <button key={value} type="button" aria-pressed={range === value}
            className="vg-range-option"
            onClick={() => { setAsOf(Date.now()); setRange(value); }}>
            {label}
          </button>
        )}
      </div>
    </header>
    {error && <p role="alert" className="mb-4 text-sm text-amber-700">{error}</p>}
    <div className="vg-metric-grid mb-5 grid gap-3 sm:grid-cols-3">
      <Stat label="Repeated tracks" number={counts.vehicles} note="Observed on multiple frames"/>
      <Stat label="Peak simultaneous tracks" number={counts.maximumVisible} note="Maximum detected in one frame"/>
      <Stat label="Inference frames" number={counts.analyzedFrames} note="Completed observations"/>
    </div>
    <div className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head"><div><h2>Classification breakdown</h2><p className="vg-section-subtitle">Observed classes across recorded sessions</p></div><span className="vg-metadata-chip">{byClass.length} classes</span></div>
        {loaded && byClass.length ?
          <div className="h-72 p-5">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byClass} margin={{left: 4, right: 12, bottom: 0}}>
                <CartesianGrid stroke="#edf1f5" vertical={false}/>
                <XAxis dataKey="name" tick={{fontSize:11,fill:'#64748b'}} axisLine={false} tickLine={false}/>
                <YAxis allowDecimals={false} tick={{fontSize:11,fill:'#64748b'}} axisLine={false} tickLine={false}/>
                <Tooltip cursor={{fill:'#f5f8fb'}}/>
                <Bar dataKey="count" name="Vehicles" fill="#567e8e" radius={[5,5,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div> :
          <p className="vg-empty-row">{loaded ? 'No classification data for this period.' : 'Loading data…'}</p>}
      </section>
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head"><div><h2>Sessions in range</h2><p className="vg-section-subtitle">Sorted by most recent analysis activity</p></div><span className="vg-metadata-chip">{filtered.length} sessions</span></div>
        {filtered.length ?
          <div className="vg-data-rows divide-y divide-slate-100">
            {[...filtered].sort((a, b) => b.updatedAt - a.updatedAt).slice(0,12).map(run =>
              <div key={run.id} className="vg-data-row flex items-center justify-between gap-3 px-5 py-3.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-800">{run.sourceName}</p>
                  <p className="mt-1 text-xs text-slate-500">{niceDate(run.updatedAt)}</p>
                </div>
                <div className="text-right">
                  <span className="block shrink-0 font-semibold tabular-nums text-slate-800">{countRepeatedTracks(run)}</span>
                  <span className="text-[10px] text-slate-500">repeated tracks</span>
                </div>
              </div>)}
          </div> : <div className="vg-empty-state"><strong>No sessions in this period.</strong>Choose a wider time range or analyze new footage.<Link to="/app/analyze">Start an analysis</Link></div>}
      </section>
    </div>
    <p className="vg-footnote">Repeated track IDs exclude brief detections, but ID switches may still count one vehicle twice. No physical speed is calibrated.</p>
  </main>;
}

function exportCSV(records: AnalysisRecord[]) {
  const columns = ['Session','Source','Date','Track ID','Vehicle class','Confidence','First seen (s)','Last seen (s)','Estimated km/h (uncalibrated)','Repeated track'];
  const rows = records.flatMap(run => Object.values(run.vehicles).map(t => [
    run.id,run.sourceName,new Date(run.createdAt).toISOString(),t.id,t.type,
    t.confidence.toFixed(3),t.firstSeenAt.toFixed(2),t.lastSeenAt.toFixed(2),
    t.estimatedSpeedKmh === null ? '' : t.estimatedSpeedKmh.toFixed(1),
    isRepeatedVehicleTrack(t) ? 'yes' : 'no'
  ]));
  const csv = '\uFEFF'+[columns,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  link.href=url;link.download='VisionGuard-vehicle-report.csv';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),3000);
}
async function exportPDF(records: AnalysisRecord[]) {
  // Avoid loading PDF dependencies for everyday dashboard navigation.
  const [{ jsPDF: PdfDocument }, { default: autoTable }] = await Promise.all([
    import('jspdf'), import('jspdf-autotable')
  ]);
  const data = summarizeActivity(records);
  const pdf = new PdfDocument();
  pdf.setFont('helvetica','bold');pdf.setFontSize(18);pdf.text('VisionGuard | Traffic activity',14,20);
  pdf.setFont('helvetica','normal');pdf.setFontSize(10);
  pdf.text('Exported '+new Date().toLocaleString(),14,29);
  pdf.text('Optical speed proxies are uncalibrated, NOT verified road speeds.',14,36);
  pdf.text('Sessions: '+data.runs+'  |  Repeated tracks: '+data.vehicles+'  |  Review flags: '+data.violations,14,45);
  const rows = records.flatMap(run=>Object.values(run.vehicles).map(v=>[
    run.sourceName.slice(0,32),String(v.id),v.type,
    String(Math.round(v.confidence*100))+'%',
    v.estimatedSpeedKmh===null?'N/A':'~'+Math.round(v.estimatedSpeedKmh)
  ]));
  autoTable(pdf,{
    startY:54,head:[['Video/stream','Track','Class','Confidence','Est. km/h']],
    body:rows,theme:'striped',styles:{fontSize:8},headStyles:{fillColor:[41,68,79]},
  });
  const flags = records.flatMap(run => run.violations.map(flag => [
    run.sourceName.slice(0,25),
    flag.trackId == null ? '—' : String(flag.trackId),
    incidentLabel(flag.type),
    incidentReviewLabel(flag.status),
    flag.evidenceNote.slice(0,160)
  ]));
  if (flags.length) {
    const previousTableEnd = (pdf as jsPDF & {lastAutoTable?: {finalY: number}})
      .lastAutoTable?.finalY ?? 54;
    autoTable(pdf,{
      startY: previousTableEnd + 12,
      head:[['Session','Track','Review reason','Status','Evidence / note']],
      body:flags, theme:'striped', styles:{fontSize:7},
      headStyles:{fillColor:[70,100,112]},
      columnStyles:{4:{cellWidth:60}}
    });
  }
  pdf.save('VisionGuard-activity-report.pdf');
}

function exportIncidentsCSV(records: AnalysisRecord[]) {
  const columns = ['Session','Source','Flag ID','Track ID','Review reason','Status','Observed at','Evidence / note'];
  const rows = records.flatMap(run => run.violations.map(event => [
    run.id, run.sourceName, event.id, event.trackId ?? '', incidentLabel(event.type),
    incidentReviewLabel(event.status), new Date(event.observedAt).toISOString(), event.evidenceNote
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
  const [pdfBusy, setPdfBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const filtered = selected === 'all' ? records : records.filter(r=>r.id===selected);
  const totals = summarizeActivity(filtered);
  const downloadPdf = async () => {
    if (pdfBusy || !loaded || !filtered.length) return;
    setPdfBusy(true);
    setExportError(null);
    try {
      await exportPDF(filtered);
    } catch {
      setExportError('Could not create the PDF. Please try again.');
    } finally {
      setPdfBusy(false);
    }
  };
  return <main className="vg-page">
    <header className="vg-page-header">
      <div><h1>Reports</h1><p>Export tracked activity by session</p></div>
    </header>
    {error && <p role="alert" className="mb-4 text-sm text-amber-700">{error}</p>}
    {exportError && <p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{exportError}</p>}
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
          <Stat label="Repeated tracks" number={totals.vehicles} note="Raw CSV includes brief candidates"/>
          <Stat label="Review flags" number={totals.violations}
            note={totals.pendingReviews + ' pending · ' +
              (totals.reviewedFlags + totals.dismissedFlags) + ' handled'}/>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" disabled={pdfBusy || !loaded || !filtered.length} onClick={() => void downloadPdf()}
            className="vg-primary" aria-busy={pdfBusy}><Download size={15}/>{pdfBusy ? 'Preparing PDF…' : 'Download PDF'}</button>
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
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleVideos = normalizedSearch ? b2Videos.filter(video =>
    video.filename.toLocaleLowerCase().includes(normalizedSearch)) : b2Videos;
  const visibleSessions = normalizedSearch ? records.filter(run =>
    run.sourceName.toLocaleLowerCase().includes(normalizedSearch)) : records;
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
  return <main className="vg-page vg-data-page">
    <header className="vg-page-header vg-history-heading">
      <div><span className="vg-page-kicker">LIBRARY / SAVED ACTIVITY</span><h1>History</h1><p>Sessions, original files and optional cloud backups—in one view.</p></div>
      <div className="vg-search-field">
        <Search size={17} aria-hidden="true" />
        <input type="search" value={search} onChange={event => setSearch(event.target.value)}
          placeholder="Search videos or sessions" aria-label="Search saved videos and sessions" />
      </div>
    </header>
    {error && <p role="alert" className="mb-4 text-sm text-amber-700">{error}</p>}
    <div className="space-y-5">
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head">
          <div><h2>On this device</h2><p className="vg-section-subtitle">Most recently retained original</p></div>
          <Link to="/app/analyze">Video analysis</Link>
        </div>
        {localError && <p role="alert" className="vg-empty-row text-amber-700">{localError}</p>}
        {!localError && !localVideo && <p className="vg-empty-row">
          No original video retained on this device. Analysis records are still available below.
          To replay footage later, choose <strong>Keep this video on this device</strong> when analyzing.
          <Link to="/app/analyze" className="ml-2 font-semibold text-[#2356a8] hover:underline">Open Live Analysis</Link>
        </p>}
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
          <div><h2>Video storage · Backblaze B2</h2><p className="vg-section-subtitle">Originals uploaded with your permission</p></div>
          <Link to="/app/archive-videos">Manage storage</Link>
        </div>
        {b2Error && <p role="alert" className="p-4 text-sm text-amber-700">{b2Error}</p>}
        {b2Loading ? <p className="vg-empty-row">Loading video records…</p> :
          !visibleVideos.length ? <div className="vg-empty-state"><strong>{normalizedSearch ? 'No matching cloud videos.' : 'No videos stored in B2.'}</strong>{normalizedSearch ? 'Try a different filename.' : 'Cloud backup is optional and requires an explicit upload.'}</div> :
          <div className="divide-y divide-slate-100">
            {visibleVideos.map(video =>
              <div key={video.id} className="vg-data-row flex flex-wrap items-center gap-4 px-5 py-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <Film size={17}/>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{video.filename}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(video.uploaded_at).toLocaleString()}
                    {video.file_size ? ' · '+(video.file_size/1048576).toFixed(1)+' MB' : ''}</p>
                </div>
                <span className="text-xs text-slate-500">
                  {video.storage_path ? 'Stored' :
                    typeof video.metadata?.upload_error === 'string' &&
                    describeCloudVideoFailure(video.metadata.upload_error).kind === 'not_configured' ?
                      'Cloud not configured' :
                    video.metadata?.upload_status === 'failed' || video.processing_status === 'failed' ?
                      'Upload failed' : 'Not stored'}
                </span>
                <Link to={'/app/archive-videos?video='+encodeURIComponent(video.id)}
                  className="text-xs font-semibold text-[#2356a8] hover:underline">Details</Link>
              </div>)}
          </div>}
      </section>
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head"><div><h2>Analysis sessions</h2><p className="vg-section-subtitle">Saved observations, separate from original footage</p></div><span className="vg-metadata-chip">{visibleSessions.length} of {records.length}</span></div>
        {!loaded ? <p className="vg-empty-row">Loading session history…</p> :
          !visibleSessions.length ? <div className="vg-empty-state"><strong>{normalizedSearch ? 'No matching sessions.' : 'No saved sessions yet.'}</strong>{normalizedSearch ? 'Try another search term.' : 'Your analysis history will appear after processing footage.'}<Link to="/app/analyze">Open Live Analysis</Link></div> :
          <div className="divide-y divide-slate-100">
            {visibleSessions.map(run =>
              <div key={run.id} className="vg-data-row flex items-center gap-4 px-5 py-3.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-800">{run.sourceName}</div>
                  <div className="mt-1 text-xs text-slate-500">{niceDate(run.createdAt)} · {run.sourceType==='live-stream'?'Live source':'Video'}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums text-slate-800">{countRepeatedTracks(run)}</div>
                  <div className="text-[11px] text-slate-500">vehicles</div>
                </div>
              </div>)}
          </div>}
      </section>
    </div>
    <p className="vg-footnote">Analysis records are retained separately from source video files. Saving a session does not upload its footage.</p>
  </main>;
}

function IncidentRow({
  run, event, onReview,
}: {
  run: AnalysisRecord;
  event: ViolationRecord;
  onReview: (runId: string, eventId: string, status: ViolationRecord['status']) => void;
}) {
  const automatic = event.id.startsWith('auto:');
  const statusLabel = incidentReviewLabel(event.status);
  const statusClass = event.status === 'approved'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : event.status === 'rejected'
      ? 'border-slate-200 bg-slate-50 text-slate-600'
      : 'border-amber-200 bg-amber-50 text-amber-900';
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
    <div className="flex shrink-0 flex-col items-end gap-2">
      <span className={'rounded-md border px-2.5 py-1 text-xs font-medium ' + statusClass}>
        {statusLabel}
      </span>
      <div className="flex flex-wrap justify-end gap-1.5">
        {event.status === 'pending_review' ? <>
          <button type="button" onClick={() => onReview(run.id, event.id, 'approved')}
            aria-label={'Mark ' + incidentLabel(event.type) + ' as reviewed'}
            className="rounded-md border border-blue-200 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">
            Mark reviewed
          </button>
          <button type="button" onClick={() => onReview(run.id, event.id, 'rejected')}
            aria-label={'Dismiss ' + incidentLabel(event.type)}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
            Dismiss
          </button>
        </> :
          <button type="button" onClick={() => onReview(run.id, event.id, 'pending_review')}
            aria-label={'Reopen ' + incidentLabel(event.type) + ' for review'}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
            Reopen
          </button>}
      </div>
    </div>
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
  const [statusFilter, setStatusFilter] = useState<'all' | ViolationRecord['status']>('all');
  const run = records.find(r => r.id === runId) ?? records[0];
  const tracks = run ? Object.values(run.vehicles).sort((a, b) => a.id - b.id) : [];
  const chosenTrack = tracks.find(t => String(t.id) === trackId);
  const { automatic, manual } = groupIncidentRecords(records);
  const incidents = [...automatic, ...manual];
  const visibleAutomatic = statusFilter === 'all' ? automatic :
    automatic.filter(item => item.event.status === statusFilter);
  const visibleManual = statusFilter === 'all' ? manual :
    manual.filter(item => item.event.status === statusFilter);
  const pendingCount = incidents.filter(item => item.event.status === 'pending_review').length;
  const reviewedCount = incidents.filter(item => item.event.status === 'approved').length;
  const dismissedCount = incidents.filter(item => item.event.status === 'rejected').length;

  const changeReview = (incidentRunId: string, eventId: string, status: ViolationRecord['status']) => {
    if (!loaded || !userId ||
        !activityLedger.setIncidentReviewStatus(userId, incidentRunId, eventId, status)) return;
    setFeedback('Saving review…');
    void activityLedger.flush(userId).then(() => {
      // A delayed save for a previous click/account must not show false
      // success after a different decision or a sign-in change.
      if (useAuthStore.getState().user?.id !== userId) return;
      const current = activityLedger.snapshot(userId).records.find(item => item.id === incidentRunId)
        ?.violations.find(item => item.id === eventId);
      if (current?.status === status) setFeedback('Review saved on this device.');
    }).catch(() => {
      if (useAuthStore.getState().user?.id === userId)
        setFeedback('Could not save the review. Check browser storage.');
    });
  };

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
    <header className="vg-page-header vg-incidents-header">
      <div>
        <span className="vg-page-kicker">OBSERVATIONS / HUMAN REVIEW</span>
        <h1>Incidents</h1>
        <p>Review potential events and decide what needs follow-up.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button"
          aria-controls="manual-incident-form" aria-expanded={manualOpen}
          onClick={() => { setManualOpen(value => !value); setFeedback(''); }}
          className="vg-secondary inline-flex items-center gap-1.5 text-xs">
          {manualOpen ? <X size={15}/> : <Plus size={15}/>}
          {manualOpen ? 'Close' : 'Add incident'}
        </button>
      </div>
    </header>
    <div className="vg-incident-filters" role="group" aria-label="Filter incidents by review status">
      {([
        ['all', 'All observations', incidents.length],
        ['pending_review', 'Needs review', pendingCount],
        ['approved', 'Reviewed', reviewedCount],
        ['rejected', 'Dismissed', dismissedCount],
      ] as const).map(([value, label, count]) =>
        <button key={value} type="button" className="vg-filter-pill"
          aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>
          <span>{label}</span><b>{count}</b>
        </button>
      )}
    </div>
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
        !visibleAutomatic.length ?
          <p className="vg-empty-row">{automatic.length ? 'No detections match this filter.' :
            'No automatic incidents recorded yet.'}</p> :
        <div className="divide-y divide-slate-100">
          {visibleAutomatic.map(({ run: item, event }) =>
            <IncidentRow key={item.id + ':' + event.id} run={item} event={event}
              onReview={changeReview}/>)}
        </div>}
    </section>

    {!!manual.length && <section className="vg-panel mt-4 overflow-hidden">
      <div className="vg-section-head">
        <h2>Manual incidents</h2>
        <span className="text-xs tabular-nums text-slate-500">{manual.length}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {visibleManual.length ? visibleManual.map(({ run: item, event }) =>
          <IncidentRow key={item.id + ':' + event.id} run={item} event={event}
            onReview={changeReview}/>) :
          <p className="vg-empty-row">No manual incidents match this filter.</p>}
      </div>
    </section>}
    <p className="vg-footnote">Reviewed means checked by a person—not a verified traffic offence.
      Review decisions are saved with the incident and included in exported reports.</p>
  </main>;
}
