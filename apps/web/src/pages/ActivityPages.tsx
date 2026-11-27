import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { localAnalysisStorage } from '../services/localAnalysisStorage';
import { describeCloudVideoFailure } from '../services/cloudVideoFeedback';
import { Link, useSearchParams } from 'react-router-dom';
import { Modal } from '../components/ui/Modal';
import { analysisSource, breakdown } from '../services/reportData';
import { getAssetAvailability } from '../lib/videoAssets';
import type { VideoAsset } from '../services/db';
import '../styles/activity-experience.css';
import { PaginatedRows } from '../components/ui/PaginatedRows';
import { ArrowUpRight, Film, Plus, Search, X } from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { activityLedger, countRepeatedTracks, summarizeActivity, useActivityLedger, type AnalysisRecord, type ViolationRecord } from '../services/activityLedger';
import { groupIncidentRecords, incidentLabel, incidentReviewLabel, manualIncidentEvidence } from '../services/incidentPresentation';

const niceDate = (time: number) => new Date(time).toLocaleString();
const fmt = (n: number) => n.toLocaleString();

function useRuns() {
  const userId = useAuthStore(s => s.user?.id ?? null);
  const data = useActivityLedger(userId);
  const stats = useMemo(() => summarizeActivity(data.records), [data.records]);
  return { ...data, stats, userId };
}

function Stat({ label, number, note }: { label: string; number: number | null; note: string }) {
  return <section className="vg-stat" aria-label={label}>
    <div className="vg-stat-label">{label}</div>
    <div className="vg-stat-value">{number === null ? '—' : fmt(number)}</div>
    <div className="vg-stat-foot">{note}</div>
  </section>;
}

function VehicleBreakdown({ data }: { data: { name: string; count: number }[] }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  return <ul className="vg-class-breakdown" aria-label="Repeated tracks by vehicle class">
    {data.map(({ name, count }) => <li key={name}>
      <span>{name}</span><strong>{fmt(count)}</strong><small>{Math.round(count / total * 100)}%</small>
      <i aria-hidden="true"><span style={{ width: count / total * 100 + '%' }}/></i>
    </li>)}
  </ul>;
}

function RecentRuns({ records, loaded }: { records: AnalysisRecord[]; loaded: boolean }) {
  return <section className="vg-panel overflow-hidden">
    <div className="vg-section-head"><h2>Recent sessions</h2><Link to="/app/videos">View history</Link></div>
    {!loaded ? <p role="status" className="vg-empty-row">Loading saved sessions…</p> :
      !records.length ? <div className="vg-empty-state">
        <strong>No saved sessions yet.</strong> Open footage to start recording vehicle observations.
      </div> : <div className="divide-y divide-slate-100">
        {records.slice(0, 6).map(run => <div key={run.id} className="vg-run-row flex items-center gap-3 px-4 py-3 text-sm">
          <div className="vg-run-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"><Film size={16}/></div>
          <div className="min-w-0 flex-1">
            <Link to={'/app/reports?session=' + encodeURIComponent(run.id)} className="vg-run-name block truncate hover:underline" title={run.sourceName}>{run.sourceName}</Link>
            <div className="vg-run-meta mt-1">{niceDate(run.createdAt)} · {analysisSource(run)}</div>
          </div>
          <div className="text-right">
            <div className="vg-run-count tabular-nums">{fmt(countRepeatedTracks(run))}</div>
            <div className="text-[11px] text-slate-500">repeated tracks</div>
          </div>
        </div>)}
      </div>}
  </section>;
}

export function ActivityDashboard() {
  const { records, loaded, stats, error } = useRuns();
  const classes = breakdown(stats.distribution);
  const awaiting = records.filter(run => run.violations.some(flag => flag.status === 'pending_review')).slice(0, 4);
  return <div className="vg-page vg-data-page vg-overview">
    <header className="vg-page-header">
      <div><h1>Overview</h1><p>Recent traffic analysis and observations awaiting review.</p></div>
      <Link to="/app/analyze" className="vg-primary">New analysis <ArrowUpRight size={16} aria-hidden="true"/></Link>
    </header>
    {!loaded && <p role="status" className="sr-only">Loading workspace…</p>}
    {error && <p role="alert" className="vg-activity-alert">{error}</p>}
    <div className="vg-metric-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Saved sessions" number={loaded ? stats.runs : null} note="Recordings and live sources"/>
      <Stat label="Repeated vehicle tracks" number={loaded ? stats.vehicles : null}
        note={loaded ? fmt(stats.transientTrackCandidates) + ' other track rows excluded' : 'Observed on multiple frames'}/>
      <Stat label="Inference frames" number={loaded ? stats.analyzedFrames : null} note="Frames analyzed by the detector"/>
      <Stat label="Needs review" number={loaded ? stats.pendingReviews : null} note={loaded ? fmt(stats.violations) + ' total review flags' : 'Pending human review'}/>
    </div>
    <div className="vg-activity-grid">
      <RecentRuns records={records} loaded={loaded}/>
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head"><h2>Review queue</h2><Link to="/app/cases">Open queue</Link></div>
        {!loaded ? <p className="vg-empty-row" role="status">Loading review flags…</p> :
          !awaiting.length ? <p className="vg-empty-row">No observations are waiting for review.</p> :
          <ul className="vg-attention-list">{awaiting.map(run => <li key={run.id}>
            <Link to={'/app/cases?session=' + encodeURIComponent(run.id)}>{run.sourceName}</Link>
            <span>{run.violations.filter(flag => flag.status === 'pending_review').length} pending</span>
          </li>)}</ul>}
      </section>
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head"><h2>Vehicle classes</h2><Link to="/app/analytics">View analytics</Link></div>
        {loaded && classes.length ? <VehicleBreakdown data={classes}/> :
          <p className="vg-empty-row">{loaded ? 'No repeated tracks to chart.' : 'Loading vehicle classes…'}</p>}
      </section>
    </div>
    <p className="vg-footnote">Repeated tracks meet duration and confidence rules. Tracking interruptions and replays can count a physical vehicle more than once.</p>
  </div>;
}

const dayMs = 86_400_000;
const timeRanges = [
  ['all', 'All time', Infinity], ['today', '24 hours', dayMs],
  ['week', '7 days', 7 * dayMs], ['month', '30 days', 30 * dayMs],
] as const;

function SessionActivity({ records }: { records: AnalysisRecord[] }) {
  const byDay = new Map<string, { day: number; sessions: number; tracks: number }>();
  for (const run of records) {
    const date = new Date(run.createdAt);
    const key = date.toLocaleDateString();
    const row = byDay.get(key) ?? { day: date.setHours(0, 0, 0, 0), sessions: 0, tracks: 0 };
    row.sessions += 1;
    row.tracks += countRepeatedTracks(run);
    byDay.set(key, row);
  }
  const days = [...byDay.values()].sort((a, b) => b.day - a.day).slice(0, 10).reverse();
  const max = Math.max(1, ...days.map(item => item.sessions));
  const date = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  if (!days.length) return <p className="vg-empty-row">No sessions started in this period.</p>;
  return <ul className="vg-activity-bars" aria-label="Session starts on the last ten active days">
    {days.map(item => <li key={item.day}>
      <span>{date.format(item.day)}</span>
      <i title={fmt(item.sessions) + ' sessions'} aria-hidden="true"><span style={{ width: item.sessions / max * 100 + '%' }}/></i>
      <strong>{fmt(item.sessions)} <span>sessions</span></strong><small>{fmt(item.tracks)} tracks</small>
    </li>)}
  </ul>;
}

export function ActivityAnalytics() {
  const { records, loaded, error } = useRuns();
  const [range, setRange] = useState<typeof timeRanges[number][0]>('all');
  const [order, setOrder] = useState<'recent' | 'tracks'>('recent');
  const [asOf, setAsOf] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setAsOf(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const filtered = useMemo(() => {
    const span = timeRanges.find(([value]) => value === range)?.[2] ?? Infinity;
    return records.filter(run => run.createdAt >= asOf - span && run.createdAt <= asOf);
  }, [range, records, asOf]);
  const counts = useMemo(() => summarizeActivity(filtered), [filtered]);
  const byClass = breakdown(counts.distribution);
  const comparison = filtered.map(run => ({ run, tracks: countRepeatedTracks(run) }))
    .sort((a, b) => order === 'tracks' ? b.tracks - a.tracks || b.run.createdAt - a.run.createdAt : b.run.createdAt - a.run.createdAt);
  return <div className="vg-page vg-data-page">
    <header className="vg-page-header">
      <div><h1>Analytics</h1><p>Compare sessions, track populations and vehicle classes.</p></div>
      <div role="group" aria-label="Analytics time range" className="vg-range-control">
        {timeRanges.map(([value, label]) => <button key={value} type="button" aria-pressed={range === value}
          className="vg-range-option" onClick={() => { setAsOf(Date.now()); setRange(value); }}>{label}</button>)}
      </div>
    </header>
    {error && <p role="alert" className="vg-activity-alert">{error}</p>}
    <div className="vg-metric-grid mb-4 grid gap-3 sm:grid-cols-3">
      <Stat label="Repeated tracks" number={loaded ? counts.vehicles : null} note="Tracks observed on multiple frames"/>
      <Stat label="Peak simultaneous tracks" number={loaded ? counts.maximumVisible : null} note="Largest visible set in a detector frame"/>
      <Stat label="Inference frames" number={loaded ? counts.analyzedFrames : null} note="Frames analyzed by the detector"/>
    </div>
    <div className="vg-activity-grid vg-analytics-grid">
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head"><div><h2>Session activity</h2><p className="vg-section-subtitle">Up to 10 active days, by session start</p></div></div>
        {loaded ? <SessionActivity records={filtered}/> : <p className="vg-empty-row" role="status">Loading activity…</p>}
      </section>
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head"><div><h2>Classification breakdown</h2><p className="vg-section-subtitle">Repeated tracks by vehicle class</p></div></div>
        {loaded && byClass.length ? <VehicleBreakdown data={byClass}/> :
          <p className="vg-empty-row">{loaded ? 'No classification data for this period.' : 'Loading data…'}</p>}
      </section>
      <section className="vg-panel vg-session-comparison overflow-hidden">
        <div className="vg-section-head"><div><h2>Session comparison</h2><p className="vg-section-subtitle">{loaded ? fmt(filtered.length) + ' sessions' : 'Loading'}</p></div>
          <label className="vg-inline-filter">Sort by <select className="vg-field" value={order} onChange={event => setOrder(event.target.value as typeof order)}>
            <option value="recent">Newest</option><option value="tracks">Most repeated tracks</option>
          </select></label>
        </div>
        {!loaded ? <p className="vg-empty-row" role="status">Loading sessions…</p> : comparison.length ?
          <PaginatedRows items={comparison} itemLabel="sessions" resetKey={range + order} renderRow={({ run, tracks }) =>
            <div key={run.id} className="vg-data-row vg-comparison-row">
              <div><Link to={'/app/reports?session=' + encodeURIComponent(run.id)} title={run.sourceName}>{run.sourceName}</Link>
                <small>{niceDate(run.createdAt)} · {analysisSource(run)}</small></div>
              <span><strong>{fmt(tracks)}</strong> repeated tracks</span>
              <span><strong>{fmt(run.analyzedFrames)}</strong> inference frames</span>
              <span><strong>{fmt(run.violations.length)}</strong> flags</span>
            </div>}/> : <p className="vg-empty-row">No sessions match this period.</p>}
      </section>
    </div>
    <p className="vg-footnote">A track ID belongs to one session. Repeated track counts can include the same physical vehicle after a tracking interruption.</p>
  </div>;
}

interface B2VideoRow {
  id: string;
  filename: string;
  file_size: number | null;
  uploaded_at: string;
  storage_path: string | null;
  processing_status: string | null;
  metadata: VideoAsset['metadata'];
}

function originalStatus(video: B2VideoRow) {
  const availability = getAssetAvailability(video, undefined, false);
  if (availability.kind === 'available') return 'B2 backup';
  if (availability.kind === 'uploading') return 'B2 upload in progress';
  if (availability.kind === 'upload_failed') return describeCloudVideoFailure(availability.detail).kind === 'not_configured'
    ? 'Cloud storage unavailable' : 'B2 upload failed';
  return video.processing_status === 'failed' ? 'Upload failed' : 'Original unavailable';
}

export function ActivityVideoLibrary() {
  // Remount account-scoped async state synchronously on identity change.
  // An effect-only reset can briefly render the previous owner's filenames.
  const ownerId = useAuthStore(state => state.user?.id ?? null);
  return <AccountVideoLibrary key={ownerId ?? 'signed-out'}/>;
}

function AccountVideoLibrary() {
  const { records, loaded, error, userId } = useRuns();
  const [b2Videos, setB2Videos] = useState<B2VideoRow[]>([]);
  const [localVideo, setLocalVideo] = useState<{name: string; size: number; runId?: string} | null>(null);
  const [localError, setLocalError] = useState('');
  const [localLoading, setLocalLoading] = useState(Boolean(userId));
  const [sourceFilter, setSourceFilter] = useState<'all' | 'recorded' | 'live'>('all');
  const [b2Loading, setB2Loading] = useState(Boolean(userId));
  const [storageRetry, setStorageRetry] = useState(0);
  const [b2Error, setB2Error] = useState('');
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState<'recent' | 'tracks' | 'name'>('recent');
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleVideos = normalizedSearch ? b2Videos.filter(video =>
    video.filename.toLocaleLowerCase().includes(normalizedSearch)) : b2Videos;
  const visibleSessions = records.filter(run =>
    (!normalizedSearch || [run.sourceName, run.id].some(value => value.toLocaleLowerCase().includes(normalizedSearch))) &&
    (sourceFilter === 'all' || (sourceFilter === 'live' ? run.sourceType === 'live-stream' : run.sourceType !== 'live-stream')))
    .sort((a, b) => order === 'name' ? a.sourceName.localeCompare(b.sourceName) :
      order === 'tracks' ? countRepeatedTracks(b) - countRepeatedTracks(a) : b.createdAt - a.createdAt);
  const cloudByRun = new Map<string, B2VideoRow>();
  for (const video of b2Videos) {
    const runId = video.metadata && typeof video.metadata === 'object' && !Array.isArray(video.metadata) &&
      video.metadata.analysis_run_id;
    if (typeof runId === 'string' && (!cloudByRun.has(runId) || getAssetAvailability(video, undefined, false).kind === 'available'))
      cloudByRun.set(runId, video);
  }
  useEffect(() => {
    setLocalVideo(null); setLocalError('');
    setLocalLoading(Boolean(userId));
    if (!userId) return;
    let alive = true;
    void localAnalysisStorage.loadVideo(userId).then(saved => {
      if (!alive) return;
      setLocalError('');
      setLocalVideo(saved ? { name: saved.name, size: saved.file.size, runId: saved.runId } : null);
    }).catch(error => {
      if (!alive) return;
      setLocalVideo(null);
      setLocalError('Could not access the retained local file: ' +
        (error instanceof Error ? error.message : String(error)));
    }).finally(() => { if (alive) setLocalLoading(false); });
    return () => { alive = false; };
  }, [userId]);
  useEffect(() => {
    setB2Videos([]); setB2Error(''); setB2Loading(Boolean(userId));
    if (!userId) return;
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
  },[userId,storageRetry]);
  return <div className="vg-page vg-data-page">
    <header className="vg-page-header vg-history-heading">
      <div><h1>History</h1><p>Find saved sessions and check which originals are available.</p></div>
      <div className="vg-search-field">
        <Search size={17} aria-hidden="true" />
        <input type="search" value={search} onChange={event => setSearch(event.target.value)}
          placeholder="Search videos or sessions" aria-label="Search saved videos and sessions" />
      </div>
    </header>
    {error && <p role="alert" className="mb-4 text-sm text-amber-700">{error}</p>}
    <div className="space-y-5">
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head"><div><h2>Analysis sessions</h2><p className="vg-section-subtitle">{loaded ? visibleSessions.length + ' of ' + records.length + ' sessions' : 'Loading'}</p></div>
          <label className="vg-inline-filter">Sort by <select className="vg-field" value={order} onChange={event => setOrder(event.target.value as typeof order)}>
            <option value="recent">Newest</option><option value="tracks">Most tracks</option><option value="name">Source name</option>
          </select></label>
        </div>
        <div className="vg-history-filter" role="group" aria-label="Filter analysis sessions by source">
          {([['all','All sources'],['recorded','Recorded videos'],['live','Live sources']] as const).map(([value,label]) =>
            <button key={value} type="button" className="vg-range-option" aria-pressed={sourceFilter === value}
              onClick={() => setSourceFilter(value)}>{label}</button>)}
        </div>
        {!loaded ? <p className="vg-empty-row" role="status">Loading session history…</p> :
          !visibleSessions.length ? <div className="vg-empty-state">
            <strong>{normalizedSearch || sourceFilter !== 'all' ? 'No matching sessions.' : 'No saved sessions yet.'}</strong>
            {normalizedSearch || sourceFilter !== 'all' ? 'Change the search or source filter.' : 'Your analysis history will appear after processing footage.'}
          </div> : <>
          <div className="vg-history-row vg-history-labels" aria-hidden="true"><span>Source / date</span><span>Repeated tracks</span><span>Review flags</span><span>Original / actions</span></div>
          <PaginatedRows items={visibleSessions} itemLabel="analysis sessions" resetKey={normalizedSearch + sourceFilter + order}
            className="vg-history-sessions" renderRow={run => {
              const local = localVideo?.runId === run.id;
              const cloud = cloudByRun.get(run.id);
              const cloudReady = cloud && getAssetAvailability(cloud, undefined, false).kind === 'available';
              const sample = run.id.startsWith('sample:');
              const status = sample ? 'Built-in sample' : run.sourceType === 'live-stream' ? 'Live capture' :
                [local && 'On this device', cloud && originalStatus(cloud)].filter(Boolean).join(' · ') || 'No linked original';
              return <div key={run.id} className="vg-history-row">
                <div><strong>{run.sourceName}</strong><small>{niceDate(run.createdAt)} · {analysisSource(run)}</small></div>
                <div><strong>{fmt(countRepeatedTracks(run))}</strong><small className="sm:hidden">Repeated tracks</small></div>
                <div><strong>{fmt(run.violations.length)}</strong><small className="sm:hidden">Review flags</small></div>
                <div><small>{status}</small><div className="vg-history-links">
                  <Link to={'/app/reports?session=' + encodeURIComponent(run.id)}>Report</Link>
                  {local && <Link to={'/app/analyze?local=' + encodeURIComponent(run.id)}>Open local</Link>}
                  {cloudReady && <Link to={'/app/analyze?video=' + encodeURIComponent(cloud.id)}>Open B2</Link>}
                </div></div>
              </div>;
            }}/>
          </>}
      </section>
      <details className="vg-panel overflow-hidden">
        <summary className="vg-storage-disclosure-heading">Original video storage</summary>
        <div className="space-y-3 px-3 pb-3 sm:px-4">
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head">
          <div><h2>On this device</h2><p className="vg-section-subtitle">Most recently retained original</p></div>
          <Link to="/app/analyze">Video analysis</Link>
        </div>
        {localError && <p role="alert" className="vg-empty-row text-amber-700">{localError}</p>}
        {localLoading && <p role="status" className="vg-empty-row">Checking local retention…</p>}
        {!localLoading && !localError && !localVideo && <p className="vg-empty-row">
          No original video retained on this device. Sessions remain available in History.
          To replay footage later, choose <strong>Keep this video on this device</strong> when analyzing.
          <Link to="/app/analyze" className="ml-2 font-semibold text-[#bd5035] hover:underline">Open Live Analysis</Link>
        </p>}
        {localVideo && <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Film size={17}/>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">{localVideo.name}</p>
            <p className="mt-1 text-xs text-slate-500">Local only · {(localVideo.size/1048576).toFixed(1)} MB · Not uploaded to cloud</p>
          </div>
          <Link to="/app/analyze" className="text-xs font-semibold text-[#bd5035] hover:underline">Open Live Analysis</Link>
        </div>}
      </section>
      <section className="vg-panel overflow-hidden">
        <div className="vg-section-head">
          <div><h2>Video storage · Backblaze B2</h2><p className="vg-section-subtitle">Originals uploaded with your permission · {b2Loading ? 'Loading' : b2Error ? 'Unavailable' : visibleVideos.length + ' shown (latest 50)'}</p></div>
          <Link to="/app/archive-videos">Manage storage</Link>
        </div>
        {b2Error && <div className="p-4"><p role="alert" className="text-sm text-amber-700">{b2Error}</p><button type="button" className="vg-secondary mt-3" onClick={() => setStorageRetry(value => value + 1)}>Retry storage lookup</button></div>}
        {b2Loading ? <p role="status" className="vg-empty-row">Loading video records…</p> :
          b2Error ? null : !visibleVideos.length ? <div className="vg-empty-state"><strong>{normalizedSearch ? 'No matching cloud videos.' : 'No videos stored in B2.'}</strong>{normalizedSearch ? 'Try a different filename.' : 'Cloud backup is optional and requires an explicit upload.'}</div> :
          <PaginatedRows items={visibleVideos} itemLabel="cloud videos" resetKey={normalizedSearch} renderRow={video =>
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
                  {originalStatus(video)}
                </span>
                <Link to={'/app/archive-videos?video='+encodeURIComponent(video.id)}
                  className="text-xs font-semibold text-[#bd5035] hover:underline">Details</Link>
              </div>}/>}
      </section>
        </div>
      </details>
    </div>
    <p className="vg-footnote">Analysis records are retained separately from source video files. Saving a session does not upload its footage.</p>
  </div>;
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
  return <div className="vg-review-row vg-incident-row flex flex-wrap items-start justify-between gap-3 px-5 py-4 text-sm">
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-slate-800">{incidentLabel(event.type)}</p>
        <span className="vg-incident-origin">{automatic ? 'Automatic candidate' : 'Manual observation'}</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {run.sourceName} · {event.trackId === null ? 'No vehicle selected' : 'Vehicle #' + event.trackId}
        {' · ' + niceDate(event.observedAt)}
      </p>
      <details className="mt-1">
        <summary>Evidence and details</summary>
        <p className="break-words text-xs leading-5 text-slate-600">{event.evidenceNote}</p>
        <p className="mt-1 break-all text-xs text-slate-500">Session {run.id}</p>
        {event.statusUpdatedAt && <p className="mt-1 text-xs text-slate-500">Decision updated {niceDate(event.statusUpdatedAt)}</p>}
      </details>
    </div>
    <div className="flex shrink-0 flex-col items-end gap-2">
      <span className="vg-incident-status" data-status={event.status}>{statusLabel}</span>
      <div className="flex flex-wrap justify-end gap-1.5">
        {event.status === 'pending_review' ? <>
          <button type="button" onClick={() => onReview(run.id, event.id, 'approved')}
            aria-label={'Mark ' + incidentLabel(event.type) + ' as reviewed'}
            className="vg-secondary">
            Mark reviewed
          </button>
          <button type="button" onClick={() => onReview(run.id, event.id, 'rejected')}
            aria-label={'Dismiss ' + incidentLabel(event.type)}
            className="vg-secondary">
            Dismiss
          </button>
        </> :
          <button type="button" onClick={() => onReview(run.id, event.id, 'pending_review')}
            aria-label={'Reopen ' + incidentLabel(event.type) + ' for review'}
            className="vg-secondary">
            Reopen
          </button>}
      </div>
    </div>
  </div>;
}

export function ActivityIncidents() {
  const { records, loaded, error, userId } = useRuns();
  const [params] = useSearchParams();
  const [sessionFilter, setSessionFilter] = useState(params.get('session') ?? '');
  const [manualOpen, setManualOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [runId, setRunId] = useState('');
  const [trackId, setTrackId] = useState('');
  const [flagType, setFlagType] = useState<'speed_estimate_review' | 'observed_event'>('observed_event');
  const [note, setNote] = useState('');
  const [feedback, setFeedback] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ViolationRecord['status']>('pending_review');
  const run = records.find(r => r.id === runId) ?? records[0];
  const tracks = run ? Object.values(run.vehicles).sort((a, b) => a.id - b.id) : [];
  const chosenTrack = tracks.find(t => String(t.id) === trackId);
  const { automatic, manual } = groupIncidentRecords(sessionFilter ? records.filter(item => item.id === sessionFilter) : records);
  const incidents = [...automatic, ...manual].sort((a, b) => b.event.observedAt - a.event.observedAt);
  const visible = statusFilter === 'all' ? incidents : incidents.filter(item => item.event.status === statusFilter);
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
    setFormError('');
    if (!loaded || !userId || !run) {
      setFormError('Analyze footage before adding an observation.');
      return;
    }
    if (flagType === 'speed_estimate_review' && !chosenTrack) {
      setFormError('Select a vehicle for speed review.');
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
    setNote('');
    setTrackId('');
    setManualOpen(false);
    setStatusFilter('pending_review');
    if (sessionFilter && sessionFilter !== run.id) setSessionFilter(run.id);
    setFeedback('Saving incident…');
    void activityLedger.flush(userId).then(() => {
      if (useAuthStore.getState().user?.id === userId) setFeedback('Incident saved for review on this device.');
    }).catch(() => {
      if (useAuthStore.getState().user?.id === userId) setFeedback('Could not save the incident to device storage.');
    });
  };

  return <div className="vg-page">
    <header className="vg-page-header vg-incidents-header">
      <div>
        <h1>Incidents</h1>
        <p>Review potential events and decide what needs follow-up.</p>
      </div>
      <button type="button" aria-haspopup="dialog" onClick={() => {
        if (sessionFilter) { setRunId(sessionFilter); setTrackId(''); }
        setFormError('');
        setManualOpen(true);
      }} className="vg-primary"><Plus size={16}/> Add incident</button>
    </header>
    <div className="vg-incident-toolbar">
    <div className="vg-incident-filters" role="group" aria-label="Filter incidents by review status">
      {([
        ['pending_review', 'Needs review', pendingCount],
        ['approved', 'Reviewed', reviewedCount],
        ['rejected', 'Dismissed', dismissedCount],
        ['all', 'All observations', incidents.length],
      ] as const).map(([value, label, count]) =>
        <button key={value} type="button" className="vg-filter-pill"
          aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>
          <span>{label}</span><b>{loaded ? count : '—'}</b>
        </button>
      )}
    </div>
    <label className="vg-inline-filter">Session <select className="vg-field" value={sessionFilter}
      onChange={event => setSessionFilter(event.target.value)}>
      <option value="">All sessions</option>
      {sessionFilter && !records.some(item => item.id === sessionFilter) && <option value={sessionFilter}>Selected session</option>}
      {records.map(item => <option key={item.id} value={item.id}>{item.sourceName} · {niceDate(item.createdAt)}</option>)}
    </select></label>
    </div>
    {error && <p role="alert" className="mb-4 text-sm text-amber-700">{error}</p>}
    {feedback && <p role="status" className="mb-4 text-xs text-slate-600">{feedback}</p>}

    {manualOpen && <Modal labelledBy="manual-incident-title" onDismiss={() => setManualOpen(false)} className="vg-incident-dialog">
      <div>
      <div className="vg-section-head"><h2 id="manual-incident-title">Add incident for review</h2>
        <button type="button" className="vg-secondary" aria-label="Close incident form" onClick={() => setManualOpen(false)}><X size={16}/></button>
      </div>
      <form onSubmit={submitFlag} className="space-y-3 p-4 sm:p-5">
        {formError && <p className="vg-activity-alert" role="alert">{formError}</p>}
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
      </div>
    </Modal>}

    <section className="vg-panel vg-incident-queue overflow-hidden">
      <div className="vg-section-head">
        <h2>Review queue</h2>
        <span className="text-xs tabular-nums text-slate-500">{loaded ? fmt(visible.length) + ' observations' : 'Loading'}</span>
      </div>
      {!loaded ? <p className="vg-empty-row" role="status">Loading incidents…</p> :
        !visible.length ? <p className="vg-empty-row">{statusFilter === 'pending_review' ? 'No observations need review.' : 'No observations match this filter.'}</p> :
        <PaginatedRows items={visible} itemLabel="observations" resetKey={statusFilter + sessionFilter}
          renderRow={({ run: item, event }) => <IncidentRow key={item.id + ':' + event.id} run={item} event={event} onReview={changeReview}/>}/>}
    </section>
    <p className="vg-footnote">Automatic detections are candidates for human review. Review decisions are included in exports.</p>
  </div>;
}
