import { useEffect, useState, useRef, useMemo, type ReactNode } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Film, Activity, FileWarning, Image, ChevronRight, Eye, Terminal, AlertTriangle, Loader2, Play, Pause, ArrowLeft, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import { db, type AnalysisRun, type VideoAsset } from '../services/db';
import { getSignedUrl } from '../pipeline/evidence/storage';
import { availabilityMessage, fallbackVideoNumbers, fetchStorageInfo, getAssetAvailability, resolveVideoUrl, storageProviderLabel, videoDisplayName } from '../lib/videoAssets';
import { uploadManager } from '../services/uploadManager';
import { AnalysisLogPanel } from '../components/analysis/AnalysisLogPanel';
import { computeVideoTransform, sourceTopLeftBoxToDisplay, sourcePointToDisplay } from '../pipeline/rendering/transform';
import { drawBoundingBoxes } from '../pipeline/rendering/overlay';
import type { TrackedObject, TrackState } from '../pipeline/types';
import { loadArtifactFromStorage, findFrameAtMediaTime, type BackendArtifactPayload } from '../services/backendAnalysis';
import type { Json } from '../types/supabase';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

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
  identicalTo: VideoAsset | null;
  artifact: BackendArtifactPayload | null;
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

export interface VideoReviewProps {
  videoId?: string;
  onBack?: () => void;
  showSidebar?: boolean;
}

export default function VideoReview({ videoId: propVideoId, onBack, showSidebar = true }: VideoReviewProps = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const videoId = propVideoId || searchParams.get('video');
  const incidentParam = searchParams.get('incident');

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
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [highlightedIncidentId, setHighlightedIncidentId] = useState<string | null>(incidentParam);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fallbackNumbers = useMemo(() => fallbackVideoNumbers(videos), [videos]);

  // Library list (sidebar)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: rows, error } = await supabase.from('video_assets').select('*').order('uploaded_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        setListError(error.message || 'Failed to load videos');
      } else {
        const fetched = (rows || []) as VideoAsset[];
        setVideos(fetched);
        if (showSidebar && !videoId && fetched.length > 0) {
          setSearchParams({ video: fetched[0].id }, { replace: true });
        }
      }
      setListLoading(false);
    })();
    return () => { cancelled = true; };
  }, [videoId, setSearchParams]);

  // Everything shown for the review is loaded for exactly `videoId`. Switching A → B clears A's
  // state synchronously and discards any of A's requests that resolve late.
  useEffect(() => {
    setData(null);
    setDetailError(null);
    setPlaybackError(null);
    setSelectedRunId(ALL_RUNS);
    setSelectedEvidence(null);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
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
      // Only this asset's own stored file is ever played; nothing falls back to another video.
      let storageInfo: Awaited<ReturnType<typeof fetchStorageInfo>> | null = null;
      try {
        storageInfo = await fetchStorageInfo();
      } catch (e) {
        warnings.push(`stored file check: ${e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)}`);
      }
      const info = storageInfo?.get(typedAsset.id);
      let identicalTo: VideoAsset | null = null;
      if (info?.identicalToVideoId) {
        const { data: twin } = await supabase.from('video_assets').select('*').eq('id', info.identicalToVideoId).maybeSingle();
        identicalTo = (twin as VideoAsset | null) ?? null;
      }
      if (cancelled) return;
      const availability = getAssetAvailability(typedAsset, info, uploadManager.getUpload(typedAsset.id)?.status === 'uploading');
      let videoUrl: string | null = null;
      if (availability.kind === 'available') {
        // Same provider abstraction as Analyze (B2: presigned, range-capable URL from the Edge Function).
        try {
          videoUrl = await resolveVideoUrl(typedAsset);
        } catch (e) {
          if (cancelled) return;
          setPlaybackError(`Could not open this video's stored file (${storageProviderLabel(typedAsset)}): ${e instanceof Error ? e.message : String(e)}`);
        }
        if (cancelled) return;
      } else {
        const reason = availabilityMessage(availability);
        setPlaybackError(availability.kind === 'uploading'
          ? 'This video is still uploading from this tab; replay is available once the upload completes.'
          : `${reason ?? 'No stored file exists for this video.'} It cannot be replayed.`);
      }

      // Load durable analysis artifact from storage
      let artifact: BackendArtifactPayload | null = null;
      const meta = (typedAsset.metadata && typeof typedAsset.metadata === 'object' && !Array.isArray(typedAsset.metadata) ? typedAsset.metadata : {}) as Record<string, any>;
      let artifactPath = meta.artifact_storage_path;
      let artifactBucket = meta.artifact_bucket || 'videos';
      if (!artifactPath && runs.length > 0) {
        for (const r of runs) {
          const runMeta = (r.metrics && typeof r.metrics === 'object' && !Array.isArray(r.metrics) ? r.metrics : {}) as Record<string, any>;
          if (runMeta.artifact_storage_path) {
            artifactPath = runMeta.artifact_storage_path;
            artifactBucket = runMeta.artifact_bucket || 'videos';
            break;
          }
        }
      }
      if (artifactPath && typeof artifactPath === 'string') {
        try {
          artifact = await loadArtifactFromStorage(artifactPath, artifactBucket);
        } catch (e) {
          warnings.push(`Analysis artifact could not be loaded: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Default to the latest run that produced tracks, so overlays from different runs never overlap.
      const runWithTracks = runs.find(r => tracks.some(t => t.analysis_run_id === r.id));
      setSelectedRunId(runWithTracks ? runWithTracks.id : ALL_RUNS);
      setData({ asset: typedAsset, videoUrl, runs, tracks, incidents, evidence, evidenceUrls, warnings, identicalTo, artifact });
      setDetailLoading(false);
    })();

    return () => { cancelled = true; };
  }, [videoId]);

  const tracks = useMemo(() => (data ? inRun(data.tracks, selectedRunId) : []), [data, selectedRunId]);
  const incidents = useMemo(() => (data ? inRun(data.incidents, selectedRunId) : []), [data, selectedRunId]);
  const evidence = useMemo(() => (data ? inRun(data.evidence, selectedRunId) : []), [data, selectedRunId]);

  const selectedRun = useMemo(() => {
    if (!data) return null;
    if (selectedRunId === ALL_RUNS) return data.runs[0] || null;
    return data.runs.find(r => r.id === selectedRunId) || null;
  }, [data, selectedRunId]);

  const framesAnalyzed = useMemo(() => {
    const meta = (data?.asset?.metadata && typeof data.asset.metadata === 'object' && !Array.isArray(data.asset.metadata) ? data.asset.metadata : {}) as Record<string, any>;
    return data?.artifact?.total_frames ??
      selectedRun?.frames_processed ??
      meta.frame_count ??
      (tracks.length > 0 ? Math.max(...tracks.map(t => t.frame_count || 0)) : 0);
  }, [data, selectedRun, tracks]);

  const uniqueVehicles = useMemo(() => {
    const summary = data?.artifact?.summary as any;
    const meta = (data?.asset?.metadata && typeof data.asset.metadata === 'object' && !Array.isArray(data.asset.metadata) ? data.asset.metadata : {}) as Record<string, any>;
    return summary?.unique_vehicles ??
      summary?.unique_tracks ??
      meta.unique_vehicles ??
      tracks.length;
  }, [data, tracks]);

  const detectionProfileLabel = useMemo(() => {
    const runMeta = (selectedRun?.metrics && typeof selectedRun.metrics === 'object' && !Array.isArray(selectedRun.metrics) ? selectedRun.metrics : {}) as Record<string, any>;
    const assetMeta = (data?.asset?.metadata && typeof data.asset.metadata === 'object' && !Array.isArray(data.asset.metadata) ? data.asset.metadata : {}) as Record<string, any>;
    const prof = data?.artifact?.summary?.detection_profile || runMeta.detection_profile || assetMeta.detection_profile;
    if (prof === 'high_recall') return 'High Recall';
    if (prof === 'balanced') return 'Balanced';
    return 'Balanced';
  }, [data, selectedRun]);

  const processingSpeedLabel = useMemo(() => {
    const runMeta = (selectedRun?.metrics && typeof selectedRun.metrics === 'object' && !Array.isArray(selectedRun.metrics) ? selectedRun.metrics : {}) as Record<string, any>;
    const assetMeta = (data?.asset?.metadata && typeof data.asset.metadata === 'object' && !Array.isArray(data.asset.metadata) ? data.asset.metadata : {}) as Record<string, any>;
    const speed = data?.artifact?.summary?.processing_speed || runMeta.processing_speed || assetMeta.processing_speed;
    if (speed === 'fast') return 'Fast (2x)';
    if (speed === 'full') return 'Full (1x)';
    return 'Full (1x)';
  }, [data, selectedRun]);

  const effectiveFps = useMemo(() => {
    const summary = data?.artifact?.summary as any;
    const artifactMeta = (data?.artifact as any)?.metrics;
    const runMeta = (selectedRun?.metrics && typeof selectedRun.metrics === 'object' && !Array.isArray(selectedRun.metrics) ? selectedRun.metrics : {}) as Record<string, any>;
    const fps = summary?.effective_fps ??
      artifactMeta?.effective_fps ??
      selectedRun?.fps ??
      runMeta.fps;
    return typeof fps === 'number' && fps > 0 ? `${Math.round(fps)} FPS` : null;
  }, [data, selectedRun]);

  const averageSpeedLabel = useMemo(() => {
    const runMeta = (selectedRun?.metrics && typeof selectedRun.metrics === 'object' && !Array.isArray(selectedRun.metrics) ? selectedRun.metrics : {}) as Record<string, any>;
    const assetMeta = (data?.asset?.metadata && typeof data.asset.metadata === 'object' && !Array.isArray(data.asset.metadata) ? data.asset.metadata : {}) as Record<string, any>;
    const avg = data?.artifact?.summary?.average_speed_kmh ??
      runMeta?.summary?.average_speed_kmh ??
      assetMeta?.average_speed_kmh;
    if (typeof avg === 'number' && avg > 0) return `${Math.round(avg)} km/h`;
    const trackSpeeds = tracks.flatMap(t => trajectoryOf(t).map(p => p.speed).filter((s): s is number => typeof s === 'number'));
    if (trackSpeeds.length > 0) {
      const mean = trackSpeeds.reduce((a, b) => a + b, 0) / trackSpeeds.length;
      return `${Math.round(mean)} km/h`;
    }
    return 'Uncalibrated';
  }, [data, selectedRun, tracks]);

  const isUnanalyzed = useMemo(() => {
    return !!data?.asset && data.asset.processing_status !== 'completed' && tracks.length === 0 && !data?.artifact;
  }, [data, tracks]);

  // Replay persisted boxes + trajectories against the playhead. No inference is run here.
  const tracksRef = useRef<TrackRow[]>([]);
  tracksRef.current = tracks;
  const artifactRef = useRef<BackendArtifactPayload | null>(null);
  artifactRef.current = data?.artifact ?? null;

  // Keyboard shortcuts: Space for play/pause, Left/Right for frame stepping
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const video = videoRef.current;
      if (!video) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 1.0 : 0.033));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + (e.shiftKey ? 1.0 : 0.033));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
      const transform = computeVideoTransform(
        { videoWidth: video.videoWidth, videoHeight: video.videoHeight },
        { containerWidth: canvas.width, containerHeight: canvas.height },
        'contain'
      );

      // 1. If we have the full frame artifact from backend inference, render exact boxes and tracks
      if (artifactRef.current && artifactRef.current.frames.length > 0) {
        const curFrame = findFrameAtMediaTime(artifactRef.current.frames, now, 0.40);
        if (curFrame) {
          const mappedTracks: TrackedObject[] = curFrame.tracks.map(track => ({
            x: track.x,
            y: track.y,
            w: track.w,
            h: track.h,
            trackId: track.track_id,
            classId: track.class_id,
            className: track.class_name,
            prob: track.prob,
            state: (track.state as TrackState) || 'Confirmed',
            frameCount: 1,
            timeSinceUpdate: track.time_since_update ?? 0,
            speed: track.speed !== null ? track.speed : undefined,
            velocity: track.velocity !== null ? track.velocity : undefined,
            isOverspeed: track.is_overspeed ?? false,
            observationType: track.observation_type as any
          }));

          drawBoundingBoxes(
            ctx,
            mappedTracks,
            canvas.width,
            canvas.height,
            video.videoWidth,
            video.videoHeight,
            false,
            0
          );
        }
      } else {
        // Fallback to trajectory interpolation for older records
        for (const t of tracksRef.current) {
          const traj = trajectoryOf(t);
          const cur = sampleAt(traj, now);
          if (!cur) continue;

          const [bx, by, bw, bh] = cur.bbox;
          // Discard implausibly large bounding boxes or tiny noise
          if (bw > video.videoWidth * 0.85 || bh > video.videoHeight * 0.85) continue;
          if (bw < 6 || bh < 6) continue;

          const rawClass = (t.object_type || 'vehicle').toLowerCase();
          const isPerson = rawClass === 'person' || rawClass === 'pedestrian';

          // Geometric plausibility filter: discard road markings and vertical poles
          if (isPerson) {
            const pAspect = bh / Math.max(1, bw);
            if (pAspect > 3.4 || pAspect < 1.1) continue;
          } else {
            const vAspect = bw / Math.max(1, bh);
            if (vAspect > 4.0 || vAspect < 0.22) continue;
          }

          // Trail of the last ~3 seconds (in source pixels)
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          let started = false;
          for (const p of traj) {
            if (p.time < now - 3 || p.time > now) continue;
            // Bottom center of vehicle touching the road
            const pt = sourcePointToDisplay(
              { x: p.bbox[0] + p.bbox[2] / 2, y: p.bbox[1] + p.bbox[3] },
              transform
            );
            if (!started) { ctx.moveTo(pt.x, pt.y); started = true; } else ctx.lineTo(pt.x, pt.y);
          }
          ctx.stroke();

          const box = sourceTopLeftBoxToDisplay({ x: bx, y: by, w: bw, h: bh }, transform);
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 2.5;
          ctx.strokeRect(box.x, box.y, box.w, box.h);

          const vehicleType = (t.object_type || 'vehicle').toUpperCase();
          let label: string;
          if (isPerson) {
            label = `#${t.track_id} PERSON`;
          } else if (typeof cur.speed === 'number' && cur.speed >= 0) {
            label = `#${t.track_id} ${vehicleType} · ${Math.round(cur.speed)} km/h`;
          } else {
            label = `#${t.track_id} ${vehicleType}`;
          }
          ctx.font = 'bold 11px Inter, sans-serif';
          const textWidth = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fillRect(box.x, Math.max(0, box.y - 20), textWidth + 10, 18);
          ctx.fillStyle = '#22d3ee';
          ctx.fillText(label, box.x + 5, Math.max(13, box.y - 6));
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data?.videoUrl]);

  // Seek to incident or time parameter when provided via query parameters
  useEffect(() => {
    if (!data?.videoUrl) return;
    const timeVal = searchParams.get('time') || searchParams.get('t');
    const incVal = searchParams.get('incident');
    if (!timeVal && !incVal) return;

    let targetTime: number | null = null;
    if (timeVal) {
      const parsed = parseFloat(timeVal);
      if (Number.isFinite(parsed) && parsed >= 0) targetTime = parsed;
    } else if (incVal && data.incidents.length > 0) {
      const foundInc = data.incidents.find(i => i.id === incVal);
      if (foundInc) {
        targetTime = incidentMediaTime(foundInc);
      }
    }

    if (targetTime !== null) {
      const video = videoRef.current;
      if (!video) return;
      const applySeek = () => {
        video.currentTime = Math.max(0, targetTime!);
        setCurrentTime(targetTime!);
        setActiveTab('timeline');
        if (incVal) setHighlightedIncidentId(incVal);
      };

      if (video.readyState >= 1) {
        applySeek();
      } else {
        video.addEventListener('loadedmetadata', applySeek, { once: true });
      }
    }
  }, [data?.videoUrl, searchParams]);

  const seekToIncident = (inc: IncidentRow) => {
    setHighlightedIncidentId(inc.id);
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
      {/* Video Selector Sidebar - shown when standalone */}
      {showSidebar && (
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
      )}

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
            {/* Top Review Header */}
            <div className="flex flex-wrap items-center justify-between px-6 py-3 border-b border-slate-200 bg-white gap-3 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (onBack) onBack();
                    else navigate('/app/videos');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                  title="Return to Saved Videos"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to History
                </button>
                <div className="h-4 w-px bg-slate-200" />
                <span className="font-bold text-slate-900 text-sm">{assetName}</span>
                <span className="text-xs text-slate-400 font-mono hidden sm:inline" title={asset.filename}>({asset.filename})</span>
                <span className={cn(
                  "px-2.5 py-0.5 rounded-full text-[11px] font-semibold border",
                  asset.processing_status === 'completed'
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : asset.processing_status === 'processing'
                    ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                    : "bg-slate-50 text-slate-600 border-slate-200"
                )}>
                  {asset.processing_status === 'completed' ? 'Completed' : asset.processing_status || 'Pending'}
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                {data.runs.length > 1 && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <label htmlFor="review-run-select">Run:</label>
                    <select
                      id="review-run-select"
                      value={selectedRunId}
                      onChange={e => setSelectedRunId(e.target.value)}
                      className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value={ALL_RUNS}>All runs ({data.runs.length})</option>
                      {data.runs.map(r => (
                        <option key={r.id} value={r.id}>
                          #{r.id.slice(0, 8)} · {new Date(r.started_at).toLocaleString()} · {r.status}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <Link
                  to={`/app/analyze?video=${encodeURIComponent(asset.id)}&reanalyze=true`}
                  className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                  title="Rerun inference on this video with chosen settings without overwriting prior results"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Analyze Again
                </Link>
              </div>
            </div>

            {/* Summary Metrics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 px-6 py-3 border-b border-slate-200 bg-white/70 shrink-0">
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Frames Analyzed</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">{framesAnalyzed}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Total frames</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Unique Vehicles</div>
                <div className="text-lg font-bold text-slate-900 mt-0.5">{uniqueVehicles}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Tracked IDs</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Incidents</div>
                <div className="text-lg font-bold text-rose-600 mt-0.5">{incidents.length}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Recorded events</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Profile</div>
                <div className="text-sm font-bold text-slate-800 mt-1 truncate">{detectionProfileLabel}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Detection profile</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Speed Mode</div>
                <div className="text-sm font-bold text-slate-800 mt-1 truncate">{processingSpeedLabel}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{effectiveFps ?? 'YOLO11n ONNX'}</div>
              </div>
              <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Average Speed</div>
                <div className="text-sm font-bold text-slate-800 mt-1">{averageSpeedLabel}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{averageSpeedLabel === 'Uncalibrated' ? 'Calibration inactive' : 'Speed zone'}</div>
              </div>
            </div>

            {/* Unanalyzed Warning State */}
            {isUnanalyzed && (
              <div className="mx-6 mt-3 p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                  <div>
                    <div className="text-sm font-bold text-amber-900">This video has not been analyzed yet</div>
                    <div className="text-xs text-amber-700 mt-0.5">Run vehicle detection and tracking to generate traffic insights, trajectory overlays, and incident reports.</div>
                  </div>
                </div>
                <Link
                  to={`/app/analyze?video=${encodeURIComponent(asset.id)}`}
                  className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors shrink-0 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" /> Start Analysis
                </Link>
              </div>
            )}

            <div className="flex-1 p-4 flex flex-col items-center justify-center relative min-h-[44vh] overflow-hidden">
              {data.warnings.length > 0 && (
                <div className="mb-2 w-full max-w-4xl bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1.5 rounded-lg text-xs">
                  Some persisted data could not be loaded: {data.warnings.join('; ')}
                </div>
              )}
              {data.videoUrl ? (
                <div className="relative rounded-2xl overflow-hidden shadow-2xl bg-black max-h-[50vh] flex items-center justify-center border border-slate-800">
                  <video
                    key={asset.id}
                    ref={videoRef}
                    src={data.videoUrl}
                    controls
                    controlsList="nofullscreen"
                    crossOrigin="anonymous"
                    playsInline
                    muted
                    preload="metadata"
                    onTimeUpdate={(e) => {
                      setCurrentTime(e.currentTarget.currentTime);
                      if (e.currentTarget.duration) setDuration(e.currentTarget.duration);
                    }}
                    onLoadedMetadata={(e) => {
                      if (e.currentTarget.duration) setDuration(e.currentTarget.duration);
                    }}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onError={() => setPlaybackError('The stored video could not be played (file missing or unreachable).')}
                    className="max-h-[50vh] w-auto max-w-full"
                  />
                  <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-10 w-full h-full" />
                </div>
              ) : null}

              {/* Interactive Timeline Scrubber with Incident Markers */}
              {data.videoUrl && (
                <div className="mt-2.5 w-full max-w-4xl bg-white border border-slate-200 rounded-xl p-2.5 shadow-xs space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const v = videoRef.current;
                          if (!v) return;
                          if (v.paused) v.play().catch(() => {});
                          else v.pause();
                        }}
                        className="p-1 hover:bg-slate-100 rounded text-slate-700 transition-colors cursor-pointer"
                        title="Play / Pause (Space)"
                      >
                        {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                      </button>
                      <button
                        onClick={() => {
                          if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 0.033);
                        }}
                        className="px-1.5 py-0.5 hover:bg-slate-100 rounded text-[11px] font-semibold text-slate-600 transition-colors cursor-pointer"
                        title="Step Backward 1 Frame (←)"
                      >
                        -1 Frame
                      </button>
                      <button
                        onClick={() => {
                          if (videoRef.current) videoRef.current.currentTime = Math.min(videoRef.current.duration || Infinity, videoRef.current.currentTime + 0.033);
                        }}
                        className="px-1.5 py-0.5 hover:bg-slate-100 rounded text-[11px] font-semibold text-slate-600 transition-colors cursor-pointer"
                        title="Step Forward 1 Frame (→)"
                      >
                        +1 Frame
                      </button>
                      <span className="font-mono text-xs font-semibold text-slate-800 ml-1">
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 text-[11px] text-slate-400">
                      <span>Space: Play/Pause</span>
                      <span>•</span>
                      <span>←/→: Step (0.033s)</span>
                      {incidents.length > 0 && (
                        <>
                          <span>•</span>
                          <span className="text-rose-600 font-medium">{incidents.length} Incident Pins</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Scrubber Track with Incident Markers */}
                  <div className="relative w-full h-4 flex items-center group cursor-pointer select-none">
                    <div
                      className="relative w-full h-2 bg-slate-200 rounded-full overflow-hidden"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                        if (videoRef.current && duration > 0) {
                          videoRef.current.currentTime = ratio * duration;
                        }
                      }}
                    >
                      <div
                        className="h-full bg-indigo-600 rounded-full transition-all"
                        style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                      />
                    </div>

                    {duration > 0 && incidents.map(inc => {
                      const t = incidentMediaTime(inc);
                      if (t === null) return null;
                      const pct = Math.max(0, Math.min(100, (t / duration) * 100));
                      const isCrit = inc.severity === 'Critical' || inc.severity === 'high';
                      const isMed = inc.severity === 'Medium' || inc.severity === 'medium';
                      const color = isCrit ? 'bg-rose-500' : isMed ? 'bg-amber-500' : 'bg-blue-500';
                      const isHighlighted = highlightedIncidentId === inc.id;
                      return (
                        <button
                          key={inc.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            seekToIncident(inc);
                          }}
                          className={cn(
                            "absolute top-1/2 -translate-y-1/2 rounded-full shadow-sm transition-all z-20 cursor-pointer",
                            color,
                            isHighlighted 
                              ? "w-3.5 h-3.5 ring-4 ring-indigo-400 ring-offset-1 scale-125 z-30" 
                              : "w-2.5 h-2.5 ring-2 ring-white hover:scale-150"
                          )}
                          style={{ left: `calc(${pct}% - 5px)` }}
                          title={`[${inc.severity || 'Incident'}] ${inc.incident_type || 'Violation'} at ${t.toFixed(1)}s (Click to seek)`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {data.identicalTo && (
                <div className="mt-2 w-full max-w-4xl bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1.5 rounded-lg text-xs">
                  This asset's stored file is byte-identical to {videoDisplayName(data.identicalTo, fallbackNumbers)} (same size and checksum) — the same source file was uploaded more than once. Tracks, incidents and evidence shown here belong to {assetName} only.
                </div>
              )}
              {playbackError && (
                <div className="mt-2 w-full max-w-4xl bg-rose-50 border border-rose-200 text-rose-700 px-3 py-1.5 rounded-lg text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> {playbackError}
                </div>
              )}
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
                              "p-3 rounded-xl flex items-center justify-between text-sm transition-all group",
                              highlightedIncidentId === inc.id
                                ? "bg-indigo-50/90 border-2 border-indigo-400 shadow-xs"
                                : "bg-slate-50 border border-slate-200",
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
