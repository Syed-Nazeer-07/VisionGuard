import { useEffect, useState, useRef, useMemo, type ReactNode } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Film, Activity, FileWarning, Image, ChevronRight, Eye, Terminal, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { db, type AnalysisRun, type VideoAsset } from '../services/db';
import { getSignedUrl } from '../pipeline/evidence/storage';
import { fallbackVideoNumbers, getStoredVideoUrl, getUploadStatus, videoDisplayName } from '../lib/videoAssets';
import { AnalysisLogPanel } from '../components/analysis/AnalysisLogPanel';
import type { Json } from '../types/supabase';

interface TrajectoryPoint {
  time: number;
  bbox: [number, number, number, number]; // top-left x, y, w, h in source pixels
  speed?: number;
}

interface TrackRow {
  id: string;
  track_id: number;
  object_type: string;
  confidence: number;
  first_seen_timestamp: number | null;
  last_seen_timestamp: number | null;
  frame_count: number | null;
  analysis_run_id: string | null;
  metadata: { trajectory?: TrajectoryPoint[] } | null;
}

interface IncidentRow {
  id: string;
  incident_type: string;
  severity: string | null;
  description: string | null;
  created_at: string;
  analysis_run_id: string | null;
  track_id: number | null;
  metadata: Record<string, Json | undefined> | null;
}

interface EvidenceRow {
  id: string;
  incident_id: string | null;
  file_type: string | null;
  file_path: string | null;
  file_url: string | null;
  thumbnail_path: string | null;
  status: string | null;
  analysis_run_id: string | null;
  capture_timestamp: string | null;
  created_at: string;
}

interface ReviewData {
  asset: VideoAsset;
  videoUrl: string | null;
  runs: AnalysisRun[];
  tracks: TrackRow[];
  incidents: IncidentRow[];
  evidence: EvidenceRow[];
  evidenceUrls: Record<string, { thumb: string; full: string }>;
  warnings: string[];
}

type Tab = 'timeline' | 'tracks' | 'evidence' | 'logs';
const ALL_RUNS = 'all';

function trajectoryOf(t: TrackRow): TrajectoryPoint[] {
  const traj = t.metadata?.trajectory;
  return Array.isArray(traj) ? traj.filter(p => Array.isArray(p.bbox) && p.bbox.length === 4) : [];
}

// Linear interpolation between the saved samples around `time` (samples are ~0.25s apart).
function sampleAt(traj: TrajectoryPoint[], time: number): TrajectoryPoint | null {
  if (traj.length === 0 || time < traj[0].time - 0.25 || time > traj[traj.length - 1].time + 0.25) return null;
  let i = 0;
  while (i < traj.length - 1 && traj[i + 1].time <= time) i++;
  const a = traj[i];
  const b = traj[i + 1];
  if (!b || b.time - a.time > 1.5 || time <= a.time) return a;
  const k = (time - a.time) / (b.time - a.time);
  return {
    time,
    bbox: [0, 1, 2, 3].map(j => a.bbox[j] + (b.bbox[j] - a.bbox[j]) * k) as [number, number, number, number],
    speed: b.speed ?? a.speed
  };
}

function inRun<T extends { analysis_run_id: string | null }>(rows: T[], runId: string): T[] {
  return runId === ALL_RUNS ? rows : rows.filter(r => r.analysis_run_id === runId);
}

function incidentMediaTime(inc: IncidentRow): number | null {
  const t = inc.metadata?.media_time;
  return typeof t === 'number' && Number.isFinite(t) ? t : null;
}

export default function VideoReview() {
  const [searchParams, setSearchParams] = useSearchParams();
  const videoId = searchParams.get('video');

  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [data, setData] = useState<ReviewData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string>(ALL_RUNS);
  const [activeTab, setActiveTab] = useState<Tab>('timeline');
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceRow | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fallbackNumbers = useMemo(() => fallbackVideoNumbers(videos), [videos]);

  // Library list (sidebar)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: rows, error } = await supabase.from('video_assets').select('*').order('uploaded_at', { ascending: false });
      if (cancelled) return;
      if (error) setListError(error.message || 'Failed to load videos');
      else setVideos((rows || []) as VideoAsset[]);
      setListLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Without ?video=, select the most recent asset through the URL (the URL stays authoritative).
  useEffect(() => {
    if (!videoId && !listLoading && videos.length > 0) {
      setSearchParams({ video: videos[0].id }, { replace: true });
    }
  }, [videoId, listLoading, videos, setSearchParams]);

  // Everything shown for the review is loaded for exactly `videoId`. Switching A → B clears A's
  // state synchronously and discards any of A's requests that resolve late.
  useEffect(() => {
    setData(null);
    setDetailError(null);
    setPlaybackError(null);
    setSelectedRunId(ALL_RUNS);
    setSelectedEvidence(null);
    if (!videoId) return;

    let cancelled = false;
    setDetailLoading(true);

    (async () => {
      const { data: asset, error: assetErr } = await supabase.from('video_assets').select('*').eq('id', videoId).maybeSingle();
      if (cancelled) return;
      if (assetErr || !asset) {
        setDetailError(assetErr ? `Could not load video asset: ${assetErr.message}` : `Video asset ${videoId} was not found.`);
        setDetailLoading(false);
        return;
      }

      const warnings: string[] = [];
      const settle = async <T,>(label: string, p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> => {
        const { data: rows, error } = await p;
        if (error) warnings.push(`${label}: ${error.message}`);
        return rows || [];
      };

      const [runs, tracks, incidents, evidence] = await Promise.all([
        db.analysisRuns.listForSource({ videoId }).catch((e: unknown) => {
          warnings.push(`analysis runs: ${e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)}`);
          return [] as AnalysisRun[];
        }),
        settle<TrackRow>('tracked objects', supabase.from('tracked_objects').select('*').eq('video_id', videoId).order('track_id', { ascending: true })),
        settle<IncidentRow>('incidents', supabase.from('incidents').select('*').eq('video_id', videoId).order('created_at', { ascending: true })),
        settle<EvidenceRow>('evidence', supabase.from('evidence').select('*').eq('video_id', videoId).order('capture_timestamp', { ascending: true }))
      ]);
      if (cancelled) return;

      // Evidence lives in a private bucket: resolve short-lived signed URLs.
      const evidenceUrls: Record<string, { thumb: string; full: string }> = {};
      await Promise.all(evidence.map(async ev => {
        const fullPath = ev.file_path || ev.file_url;
        if (!fullPath) return;
        const [full, thumb] = await Promise.all([
          getSignedUrl(fullPath),
          ev.thumbnail_path ? getSignedUrl(ev.thumbnail_path) : Promise.resolve('')
        ]);
        if (full) evidenceUrls[ev.id] = { full, thumb: thumb || full };
      }));
      if (cancelled) return;

      const typedAsset = asset as VideoAsset;
      const videoUrl = getStoredVideoUrl(typedAsset);
      if (!videoUrl) {
        const status = getUploadStatus(typedAsset);
        setPlaybackError(status === 'failed'
          ? 'The upload of this video failed, so there is no stored copy to replay.'
          : 'No stored copy of this video exists (its upload did not complete), so it cannot be replayed.');
      }

      // Default to the latest run that produced tracks, so overlays from different runs never overlap.
      const runWithTracks = runs.find(r => tracks.some(t => t.analysis_run_id === r.id));
      setSelectedRunId(runWithTracks ? runWithTracks.id : ALL_RUNS);
      setData({ asset: typedAsset, videoUrl, runs, tracks, incidents, evidence, evidenceUrls, warnings });
      setDetailLoading(false);
    })();

    return () => { cancelled = true; };
  }, [videoId]);

  const tracks = useMemo(() => (data ? inRun(data.tracks, selectedRunId) : []), [data, selectedRunId]);
  const incidents = useMemo(() => (data ? inRun(data.incidents, selectedRunId) : []), [data, selectedRunId]);
  const evidence = useMemo(() => (data ? inRun(data.evidence, selectedRunId) : []), [data, selectedRunId]);

  // Replay persisted boxes + trajectories against the playhead. No inference is run here.
  const tracksRef = useRef<TrackRow[]>([]);
  tracksRef.current = tracks;
  useEffect(() => {
    if (!data?.videoUrl) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!video.videoWidth) return;

      const now = video.currentTime;
      const sx = canvas.width / video.videoWidth;
      const sy = canvas.height / video.videoHeight;

      for (const t of tracksRef.current) {
        const traj = trajectoryOf(t);
        const cur = sampleAt(traj, now);
        if (!cur) continue;

        // Trail of the last ~3 seconds
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        for (const p of traj) {
          if (p.time < now - 3 || p.time > now) continue;
          const cx = (p.bbox[0] + p.bbox[2] / 2) * sx;
          const cy = (p.bbox[1] + p.bbox[3]) * sy;
          if (!started) { ctx.moveTo(cx, cy); started = true; } else ctx.lineTo(cx, cy);
        }
        ctx.stroke();

        const [bx, by, bw, bh] = cur.bbox;
        const x = bx * sx, y = by * sy, w = bw * sx, h = bh * sy;
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(x, y, w, h);

        const label = `${t.object_type || 'object'} #${t.track_id}${typeof cur.speed === 'number' ? ` · ${cur.speed} km/h` : ''}`;
        ctx.font = 'bold 11px Inter, sans-serif';
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(x, Math.max(0, y - 20), textWidth + 10, 18);
        ctx.fillStyle = '#22d3ee';
        ctx.fillText(label, x + 5, Math.max(13, y - 6));
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data?.videoUrl]);

  const seekToIncident = (inc: IncidentRow) => {
    const video = videoRef.current;
    const t = incidentMediaTime(inc);
    if (!video || t === null) return;
    video.currentTime = Math.max(0, t - 1);
    video.play().catch(e => setPlaybackError(`Playback could not start: ${e instanceof Error ? e.message : String(e)}`));
  };

  const selectVideo = (id: string) => {
    if (id !== videoId) setSearchParams({ video: id });
  };

  const asset = data?.asset ?? null;
  const assetName = asset ? videoDisplayName(asset, fallbackNumbers) : '';

  return (
    <div className="flex-1 h-[calc(100vh-64px)] overflow-hidden flex bg-slate-50">
      {/* Video Selector Sidebar */}
      <div className="w-80 border-r border-slate-200 bg-white flex flex-col h-full overflow-hidden shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10">
        <div className="p-4 border-b border-slate-200 bg-white sticky top-0 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Film className="w-5 h-5 text-indigo-600" />
              Video Review
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Replay persistent AI analysis</p>
          </div>
          <span className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full border border-indigo-100">
            {videos.length} Videos
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {listLoading ? (
            <div className="text-center p-6 text-sm text-slate-400">Loading video library...</div>
          ) : listError ? (
            <div className="text-center p-6 text-sm text-rose-600">Failed to load videos: {listError}</div>
          ) : videos.length === 0 ? (
            <div className="text-center p-6 text-sm text-slate-400">
              No videos uploaded yet.
              <Link to="/app/analyze" className="block mt-2 text-indigo-600 font-semibold hover:underline">
                Upload a video in Analyze →
              </Link>
            </div>
          ) : (
            videos.map(v => (
              <button
                key={v.id}
                onClick={() => selectVideo(v.id)}
                className={cn(
                  "w-full text-left p-3 rounded-xl border transition-all cursor-pointer",
                  videoId === v.id
                    ? 'bg-indigo-50 border-indigo-300 shadow-sm ring-1 ring-indigo-500/20'
                    : 'bg-white border-slate-200 hover:border-indigo-200 hover:bg-slate-50 shadow-sm'
                )}
              >
                <div className="font-semibold text-slate-900 text-sm truncate pr-2">{videoDisplayName(v, fallbackNumbers)}</div>
                <div className="text-[11px] text-slate-500 truncate" title={v.filename}>{v.filename}</div>
                <div className="text-xs text-slate-500 mt-1 flex justify-between items-center">
                  <span>{v.uploaded_at ? new Date(v.uploaded_at).toLocaleDateString() : '—'}</span>
                  <span className="font-mono text-[11px] text-slate-400">{v.id.split('-')[0]}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Analysis Display & Trajectory Overlay */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/50">
        {!videoId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <Film className="w-16 h-16 mb-4 opacity-20" />
            <p className="font-medium text-slate-500">Select a video from the library to review AI analysis</p>
          </div>
        ) : detailError ? (
          <div className="flex-1 flex flex-col items-center justify-center text-rose-600 gap-2">
            <AlertTriangle className="w-10 h-10" />
            <p className="font-medium">{detailError}</p>
          </div>
        ) : detailLoading || !data || !asset ? (
          <div className="flex-1 flex items-center justify-center text-slate-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading persisted analysis…
          </div>
        ) : (
          <>
            <div className="flex-1 p-6 flex flex-col items-center justify-center relative min-h-[50vh] overflow-hidden">
              {data.warnings.length > 0 && (
                <div className="mb-3 w-full max-w-4xl bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-lg text-xs">
                  Some persisted data could not be loaded: {data.warnings.join('; ')}
                </div>
              )}
              {data.videoUrl ? (
                <div className="relative rounded-2xl overflow-hidden shadow-2xl bg-black max-h-[58vh] flex items-center justify-center border border-slate-800">
                  <video
                    key={asset.id}
                    ref={videoRef}
                    src={data.videoUrl}
                    controls
                    crossOrigin="anonymous"
                    playsInline
                    muted
                    preload="metadata"
                    onError={() => setPlaybackError('The stored video could not be played (file missing or unreachable).')}
                    className="max-h-[58vh] w-auto max-w-full"
                  />
                  <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-10 w-full h-full" />
                </div>
              ) : null}
              {playbackError && (
                <div className="mt-3 w-full max-w-4xl bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> {playbackError}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 w-full max-w-4xl text-xs text-slate-600 px-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">{assetName}</span>
                  <span className="text-slate-400 truncate max-w-[200px]" title={asset.filename}>({asset.filename})</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">{tracks.length} Tracked Objects</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">{incidents.length} Incidents</span>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="review-run-select" className="text-slate-500">Run</label>
                  <select
                    id="review-run-select"
                    value={selectedRunId}
                    onChange={e => setSelectedRunId(e.target.value)}
                    className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs"
                  >
                    <option value={ALL_RUNS}>All runs ({data.runs.length})</option>
                    {data.runs.map(r => (
                      <option key={r.id} value={r.id}>
                        #{r.id.slice(0, 8)} · {new Date(r.started_at).toLocaleString()} · {r.status}
                      </option>
                    ))}
                  </select>
                  <Link to={`/app/analyze?video=${encodeURIComponent(asset.id)}`} className="text-indigo-600 font-semibold hover:underline">
                    Analyze →
                  </Link>
                </div>
              </div>
            </div>

            {/* Bottom Tabs */}
            <div className="h-72 border-t border-slate-200 bg-white flex flex-col shrink-0">
              <div className="flex border-b border-slate-200 px-4 bg-slate-50/80">
                <TabButton active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} icon={<FileWarning className="w-4 h-4 text-rose-500" />} label={`Incident Timeline (${incidents.length})`} />
                <TabButton active={activeTab === 'tracks'} onClick={() => setActiveTab('tracks')} icon={<Activity className="w-4 h-4 text-cyan-500" />} label={`Tracked Objects (${tracks.length})`} />
                <TabButton active={activeTab === 'evidence'} onClick={() => setActiveTab('evidence')} icon={<Image className="w-4 h-4 text-purple-500" />} label={`Captured Evidence (${evidence.length})`} />
                <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon={<Terminal className="w-4 h-4 text-emerald-500" />} label="Analysis Logs" />
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {activeTab === 'timeline' && (
                  <div className="space-y-2 max-w-4xl">
                    {incidents.length === 0 ? (
                      <div className="text-sm text-slate-500 py-6 text-center">No incidents recorded for this video{selectedRunId !== ALL_RUNS ? ' in the selected run' : ''}.</div>
                    ) : (
                      incidents.map(inc => {
                        const t = incidentMediaTime(inc);
                        return (
                          <div
                            key={inc.id}
                            onClick={() => seekToIncident(inc)}
                            className={cn(
                              "p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-sm transition-all group",
                              t !== null && data.videoUrl ? "hover:bg-indigo-50/60 hover:border-indigo-200 cursor-pointer" : ""
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <span className={cn(
                                "px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider",
                                inc.severity === 'Critical' || inc.severity === 'high' ? "bg-rose-100 text-rose-700 border border-rose-200" :
                                inc.severity === 'Medium' || inc.severity === 'medium' ? "bg-amber-100 text-amber-700 border border-amber-200" :
                                "bg-blue-100 text-blue-700 border border-blue-200"
                              )}>
                                {inc.severity || 'Medium'}
                              </span>
                              <div>
                                <div className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                                  {String(inc.incident_type || 'Traffic Violation').replace(/_/g, ' ')}
                                  {inc.track_id !== null && <span className="text-slate-400 font-mono text-xs ml-2">#{inc.track_id}</span>}
                                </div>
                                <div className="text-xs text-slate-500 mt-0.5">{inc.description || 'Incident registered by analysis engine'}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-indigo-600 font-semibold">
                              {t !== null ? (
                                <>
                                  <span>Seek to {t.toFixed(1)}s</span>
                                  <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                                </>
                              ) : (
                                <span className="text-slate-400 font-normal">No media time recorded</span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {activeTab === 'tracks' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {tracks.length === 0 ? (
                      <div className="text-sm text-slate-500 py-6 col-span-3 text-center">No object trajectories found.</div>
                    ) : (
                      tracks.map(obj => {
                        const traj = trajectoryOf(obj);
                        const speeds = traj.map(p => p.speed).filter((s): s is number => typeof s === 'number');
                        return (
                          <div
                            key={obj.id}
                            onClick={() => { if (videoRef.current && obj.first_seen_timestamp !== null) videoRef.current.currentTime = Number(obj.first_seen_timestamp); }}
                            className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm flex justify-between items-center cursor-pointer hover:border-indigo-200"
                          >
                            <div>
                              <span className="font-bold text-slate-800 capitalize">{obj.object_type || 'object'}</span>
                              <span className="text-slate-400 font-mono text-xs ml-1.5">#{obj.track_id}</span>
                              <div className="text-xs text-slate-500 mt-1">
                                {Number(obj.first_seen_timestamp ?? 0).toFixed(1)}s – {Number(obj.last_seen_timestamp ?? 0).toFixed(1)}s · {obj.frame_count ?? 0} frames · {traj.length} points
                                {speeds.length > 0 && ` · max ${Math.max(...speeds)} km/h`}
                              </div>
                            </div>
                            <span className="text-xs font-bold text-slate-700 bg-white px-2 py-1 rounded border border-slate-200">
                              {Math.round(Number(obj.confidence || 0) * 100)}% conf
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {activeTab === 'evidence' && (
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {evidence.length === 0 ? (
                      <div className="text-sm text-slate-500 py-6 col-span-full text-center">No snapshot or crop evidence records found for this video.</div>
                    ) : (
                      evidence.map(ev => {
                        const urls = data.evidenceUrls[ev.id];
                        return (
                          <div
                            key={ev.id}
                            onClick={() => setSelectedEvidence(ev)}
                            className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer group"
                          >
                            <div className="h-28 bg-slate-100 flex items-center justify-center overflow-hidden relative">
                              {urls ? (
                                <img src={urls.thumb} alt="Violation evidence" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                              ) : (
                                <span className="text-[11px] text-slate-400 px-2 text-center">{ev.status === 'failed' ? 'Upload failed' : 'Image unavailable'}</span>
                              )}
                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                                <Eye className="w-5 h-5" />
                              </div>
                            </div>
                            <div className="p-2.5 text-xs">
                              <div className="font-semibold text-slate-900 capitalize truncate">{(ev.file_type || 'snapshot').replace(/_/g, ' ')}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5 truncate">{new Date(ev.capture_timestamp || ev.created_at).toLocaleTimeString()}</div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {activeTab === 'logs' && (
                  <AnalysisLogPanel videoId={asset.id} className="h-full" />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {selectedEvidence && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelectedEvidence(null)}>
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-900 text-lg capitalize">{(selectedEvidence.file_type || 'Violation evidence').replace(/_/g, ' ')}</h3>
              <button onClick={() => setSelectedEvidence(null)} className="text-slate-400 hover:text-slate-600 font-bold text-lg">✕</button>
            </div>
            <div className="rounded-xl overflow-hidden bg-slate-950 border border-slate-200 mb-4 max-h-[60vh] flex items-center justify-center min-h-[120px]">
              {data?.evidenceUrls[selectedEvidence.id] ? (
                <img src={data.evidenceUrls[selectedEvidence.id].full} alt="Full evidence" className="max-h-[55vh] w-auto object-contain" />
              ) : (
                <span className="text-slate-400 text-sm p-6">Evidence image is not available{selectedEvidence.status ? ` (status: ${selectedEvidence.status})` : ''}.</span>
              )}
            </div>
            <div className="text-xs text-slate-500 flex justify-between items-center">
              <span>Incident ID: {selectedEvidence.incident_id || 'N/A'}</span>
              <span>Captured: {new Date(selectedEvidence.capture_timestamp || selectedEvidence.created_at).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2.5 text-xs font-bold border-b-2 flex items-center gap-2 cursor-pointer transition-all",
        active ? "border-indigo-600 text-indigo-600 bg-white" : "border-transparent text-slate-500 hover:text-slate-700"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
