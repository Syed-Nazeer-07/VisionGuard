import { supabase } from '../lib/supabase';
import { callVideoStorage } from './videoStorage';

export interface BackendHealth {
  status: string;
  service: string;
  version: string;
  model_ready: boolean;
  model_path: string;
  execution_provider: string;
  available_providers: string[];
}

export interface BackendJobProgress {
  percentage: number;
  current_frame: number;
  total_frames: number;
  fps: number;
  processing_fps: number;
  elapsed_seconds: number;
  video_duration: number;
  stage?: string;
}

export type DetectionProfile = 'balanced' | 'high_recall';

export interface DetectionProfileConfig {
  id: DetectionProfile;
  label: string;
  description: string;
  confidenceThreshold: number;
  iouThreshold: number;
}

export const DETECTION_PROFILES: Record<DetectionProfile, DetectionProfileConfig> = {
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    description: 'Benchmark reference: 0.20 confidence / 0.45 IoU. May increase false positives on new scenes.',
    confidenceThreshold: 0.20,
    iouThreshold: 0.45
  },
  high_recall: {
    id: 'high_recall',
    label: 'High Recall',
    description: 'Experimental high recall (0.15 conf / 0.45 IoU): more distant vehicles, more potential false positives.',
    confidenceThreshold: 0.15,
    iouThreshold: 0.45
  }
};

export type ProcessingSpeed = 'full' | 'fast';

export interface ProcessingSpeedConfig {
  id: ProcessingSpeed;
  label: string;
  shortLabel: string;
  description: string;
  frameStride: number;
}

export const PROCESSING_SPEEDS: Record<ProcessingSpeed, ProcessingSpeedConfig> = {
  full: {
    id: 'full',
    label: 'Full Detection',
    shortLabel: 'Full (1x)',
    description: 'Evaluates every frame (stride 1). Maximum tracking density & precision.',
    frameStride: 1
  },
  fast: {
    id: 'fast',
    label: 'Fast Processing',
    shortLabel: 'Fast (2x)',
    description: 'Evaluates every 2nd frame (stride 2). Faster video throughput (~1.8x speed).',
    frameStride: 2
  }
};

export interface BackendJobSummary {
  total_frames: number;
  processed_frames: number;
  /** Actual YOLO boxes on analyzed frames; absent on legacy artifacts. */
  detections_generated?: number;
  duration_seconds: number;
  unique_vehicles: number;
  vehicle_counts_by_class: Record<string, number>;
  max_vehicles_in_frame: number;
  average_speed_kmh?: number | null;
  speed_violations_count: number;
  detection_profile?: string;
  confidence_threshold?: number;
  iou_threshold?: number;
  processing_speed?: string;
  frame_stride?: number;
  is_calibrated?: boolean;
  calibration?: any;
}

export type BackendJobLifecycleState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackendJobStatus {
  job_id: string;
  status: BackendJobLifecycleState;
  progress?: BackendJobProgress;
  summary?: BackendJobSummary;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
  save_to_history: boolean;
  video_id?: string | null;
  detection_profile?: string;
  confidence_threshold?: number;
  iou_threshold?: number;
  processing_speed?: string;
  frame_stride?: number;
  is_calibrated?: boolean;
  calibration?: any;
}

export interface BackendBoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
  prob: number;
  class_id: number;
  class_name: string;
}

export interface BackendTrackedObject {
  track_id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  dx?: number;
  dy?: number;
  prob: number;
  class_id: number;
  class_name: string;
  speed?: number | null;
  velocity?: number | null;
  is_overspeed?: boolean;
  state?: string;
  time_since_update?: number;
  observation_type?: 'detection' | 'interpolated' | 'predicted';
  prediction_confidence?: number | null;
}

export interface BackendFrameResult {
  frame_id: number;
  media_time: number;
  source_width: number;
  source_height: number;
  boxes: BackendBoundingBox[];
  tracks: BackendTrackedObject[];
  detection_count: number;
}

export interface BackendResultsResponse {
  job_id: string;
  version: string;
  total_frames: number;
  returned_frames: number;
  offset: number;
  limit: number;
  frames: BackendFrameResult[];
}

export function getBackendBaseUrl(): string {
  const envUrl = import.meta.env.VITE_ANALYSIS_API_URL;
  if (typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:8000';
}

export async function checkBackendHealth(): Promise<{
  isAvailable: boolean;
  health?: BackendHealth;
  error?: string;
}> {
  const baseUrl = getBackendBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/api/v1/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = (await res.json()) as BackendHealth;
      return { isAvailable: true, health: data };
    }
    return { isAvailable: false, error: `HTTP ${res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { isAvailable: false, error: msg };
  }
}

export async function createAnalysisJob(
  fileOrUrl: File | string,
  saveToHistory: boolean,
  videoId?: string,
  detectionProfile: DetectionProfile = 'balanced',
  processingSpeed: ProcessingSpeed = 'full',
  calibration?: any
): Promise<{
  job_id: string;
  status: BackendJobLifecycleState;
  detection_profile?: string;
  confidence_threshold?: number;
  iou_threshold?: number;
  processing_speed?: string;
  frame_stride?: number;
  is_calibrated?: boolean;
}> {
  const baseUrl = getBackendBaseUrl();

  // Helper to construct a fresh FormData instance for fetch
  const buildFormData = async (): Promise<FormData> => {
    const fd = new FormData();
    if (typeof fileOrUrl === 'string') {
      if (fileOrUrl.startsWith('blob:')) {
        try {
          const blobRes = await fetch(fileOrUrl);
          const blob = await blobRes.blob();
          fd.append('video', blob, 'video.mp4');
        } catch {
          fd.append('video_url', fileOrUrl);
        }
      } else {
        fd.append('video_url', fileOrUrl);
      }
    } else {
      fd.append('video', fileOrUrl, fileOrUrl.name);
    }
    fd.append('save_to_history', String(saveToHistory));
    if (videoId) {
      fd.append('video_id', videoId);
    }
    fd.append('detection_profile', detectionProfile);
    fd.append('processing_speed', processingSpeed);
    if (calibration) {
      fd.append('calibration', typeof calibration === 'string' ? calibration : JSON.stringify(calibration));
    }
    return fd;
  };

  let res: Response;
  try {
    const fd = await buildFormData();
    res = await fetch(`${baseUrl}/api/v1/analysis/jobs`, {
      method: 'POST',
      body: fd
    });
  } catch (netErr) {
    throw new Error(`Cannot connect to local AI backend at ${baseUrl}. Ensure the backend is running via Start-VisionGuard.bat or switch to Browser WebGPU mode.`);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      detail = errJson.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(`Failed to create analysis job: ${detail}`);
  }

  const data = await res.json();
  return {
    job_id: data.job_id,
    status: data.status,
    detection_profile: data.detection_profile,
    confidence_threshold: data.confidence_threshold,
    iou_threshold: data.iou_threshold,
    processing_speed: data.processing_speed,
    frame_stride: data.frame_stride,
    is_calibrated: data.is_calibrated
  };
}

export async function getJobStatus(jobId: string): Promise<BackendJobStatus> {
  const baseUrl = getBackendBaseUrl();
  const res = await fetch(`${baseUrl}/api/v1/analysis/jobs/${encodeURIComponent(jobId)}`, {
    headers: { 'Accept': 'application/json' }
  });

  if (!res.ok) {
    throw new Error(`Job status request failed: HTTP ${res.status}`);
  }

  return (await res.json()) as BackendJobStatus;
}

export async function cancelAnalysisJob(jobId: string): Promise<void> {
  const baseUrl = getBackendBaseUrl();
  await fetch(`${baseUrl}/api/v1/analysis/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE'
  });
}

export async function getAllJobResults(jobId: string): Promise<BackendFrameResult[]> {
  try {
    const artifact = await fetchJobArtifactJson(jobId);
    if (artifact && Array.isArray(artifact.frames) && artifact.frames.length > 0) {
      return artifact.frames;
    }
  } catch {
    // Fall back to paginated slice if direct artifact download is unavailable
  }

  const baseUrl = getBackendBaseUrl();
  const limit = 500;
  let offset = 0;
  const allFrames: BackendFrameResult[] = [];

  while (true) {
    const res = await fetch(
      `${baseUrl}/api/v1/analysis/jobs/${encodeURIComponent(jobId)}/results?limit=${limit}&offset=${offset}`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch results at offset ${offset}: HTTP ${res.status}`);
    }

    const data = (await res.json()) as BackendResultsResponse;
    allFrames.push(...data.frames);

    if (data.frames.length < limit || allFrames.length >= data.total_frames) {
      break;
    }
    offset += data.frames.length;
  }

  return allFrames;
}

/**
 * Fast binary search to find the closest frame result to a video playback timestamp.
 * Returns null if the closest frame is beyond tolerance (e.g. video was seeked outside analysis bounds).
 */
export function findFrameAtMediaTime(
  frames: BackendFrameResult[],
  mediaTime: number,
  toleranceSeconds: number = 0.25
): BackendFrameResult | null {
  if (frames.length === 0) return null;

  let low = 0;
  let high = frames.length - 1;
  let bestCandidate: BackendFrameResult | null = null;
  let bestDelta = toleranceSeconds;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const diff = frames[mid].media_time - mediaTime;
    const delta = Math.abs(diff);

    if (delta < bestDelta) {
      bestDelta = delta;
      bestCandidate = frames[mid];
    }

    if (delta <= 0.005) {
      return frames[mid];
    } else if (diff < 0) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return bestCandidate;
}

export interface PersistedBackendJob {
  jobId: string;
  videoId?: string;
  sourceName?: string;
  displayName?: string;
  detectionProfile: DetectionProfile;
  processingSpeed: ProcessingSpeed;
  saveHistory: boolean;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | BackendJobStatus;
  startedAt: string | number;
}

const STORAGE_KEY_ACTIVE_JOB = 'visionguard_active_backend_job';
let activeJobMemory: PersistedBackendJob | null = null;

export function setActiveBackendJob(job: PersistedBackendJob | null): void {
  activeJobMemory = job;
  if (job) {
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_JOB, JSON.stringify(job));
    } catch {
      // ignore
    }
  } else {
    try {
      localStorage.removeItem(STORAGE_KEY_ACTIVE_JOB);
    } catch {
      // ignore
    }
  }
}

export function getActiveBackendJob(): PersistedBackendJob | null {
  if (activeJobMemory) return activeJobMemory;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVE_JOB);
    if (raw) {
      const parsed = JSON.parse(raw);
      activeJobMemory = parsed;
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function clearActiveBackendJob(): void {
  setActiveBackendJob(null);
}

import type { BackendSpeedingEvent } from './backendSpeedIncidents';

export interface BackendArtifactPayload {
  version: string;
  job_id: string;
  detection_profile: string;
  confidence_threshold: number;
  iou_threshold: number;
  processing_speed: string;
  frame_stride: number;
  video_metadata: {
    duration_seconds?: number;
    fps?: number;
    total_frames?: number;
    width?: number;
    height?: number;
    [key: string]: any;
  };
  summary: BackendJobSummary;
  total_frames: number;
  frames: BackendFrameResult[];
  /** 1.1+ artifacts: true frame-localized, calibrated speeding candidates. */
  speeding_events?: BackendSpeedingEvent[];
}

/**
 * Downloads the gzip-compressed JSON artifact (.json.gz) directly from the local backend.
 */
export async function downloadJobArtifactBlob(jobId: string): Promise<Blob> {
  const baseUrl = getBackendBaseUrl();
  const res = await fetch(`${baseUrl}/api/v1/analysis/jobs/${encodeURIComponent(jobId)}/artifact`);
  if (!res.ok) {
    throw new Error(`Failed to download job artifact: HTTP ${res.status}`);
  }
  return await res.blob();
}

/**
 * New analysis artifacts are stored privately in B2. Supabase is used as the
 * metadata/auth database; its Storage quota is NOT required for new runs.
 * The Edge Function verifies video ownership and the analysis run before
 * signing a single-object PUT, then HEAD-checks the resulting object size.
 * 'videos' is retained only to read historical Supabase artifacts.
 */
export const B2_ARTIFACT_BUCKET = 'b2-artifacts';

export function parseB2ArtifactPath(storagePath: string): { videoId: string; runId: string } {
  const match = /^artifacts\/([0-9a-f]{8}-[0-9a-f-]{27})\/([0-9a-f]{8}-[0-9a-f-]{27})\.json\.gz$/i.exec(storagePath);
  if (!match) throw new Error('Invalid B2 analysis artifact path');
  return { videoId: match[1], runId: match[2] };
}

/** Upload a compressed backend analysis artifact to B2 with short-lived signed PUT. */
export async function saveArtifactToStorage(
  videoId: string,
  runId: string,
  artifactBlob: Blob,
  bucket: string = B2_ARTIFACT_BUCKET
): Promise<{ storagePath: string; bucket: string; size: number }> {
  const storagePath = `artifacts/${videoId}/${runId}.json.gz`;
  if (bucket === B2_ARTIFACT_BUCKET) {
    // Validate identifiers before contacting the server or signing any URL.
    parseB2ArtifactPath(storagePath);
    const signed = await callVideoStorage<{ key: string; url: string }>({
      action: 'create-artifact-upload', videoId, runId, fileSize: artifactBlob.size
    });
    if (signed.key !== storagePath) throw new Error('B2 returned an unexpected artifact object key');
    const response = await fetch(signed.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/gzip' },
      body: artifactBlob
    });
    if (!response.ok) throw new Error(`B2 artifact upload failed: HTTP ${response.status}`);
    const confirmed = await callVideoStorage<{ exists: boolean; size: number; key: string }>({
      action: 'verify-artifact-upload', videoId, runId, fileSize: artifactBlob.size
    });
    if (!confirmed.exists || confirmed.size !== artifactBlob.size || confirmed.key !== storagePath) {
      throw new Error('B2 failed to verify the uploaded analysis artifact');
    }
    return { storagePath, bucket, size: confirmed.size };
  }

  // Explicit legacy-only path. Never silently switch new B2 uploads back to
  // quota-limited Supabase Storage if B2 configuration or network fails.
  const { error } = await supabase.storage.from(bucket).upload(storagePath, artifactBlob, {
    contentType: 'application/gzip', upsert: true
  });
  if (error) throw new Error(`Failed to save artifact to storage: ${error.message}`);
  return { storagePath, bucket, size: artifactBlob.size };
}

/**
 * Decompresses a gzip blob or string stream.
 */
async function decompressGzipBlob(blob: Blob): Promise<string> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('gzip');
      const decompressedStream = blob.stream().pipeThrough(ds);
      return await new Response(decompressedStream).text();
    } catch {
      // Fallback if not gzipped or DecompressionStream fails
    }
  }
  return await blob.text();
}

/**
 * Loads and decompresses the durable analysis artifact from Supabase Storage.
 */
export async function loadArtifactFromStorage(
  storagePath: string,
  bucket: string = 'videos'
): Promise<BackendArtifactPayload> {
  let blob: Blob | null = null;
  if (bucket === B2_ARTIFACT_BUCKET) {
    const { videoId, runId } = parseB2ArtifactPath(storagePath);
    const signed = await callVideoStorage<{ key: string; url: string }>({
      action: 'artifact-playback-url', videoId, runId
    });
    if (signed.key !== storagePath) throw new Error('B2 returned an unexpected analysis artifact key');
    const response = await fetch(signed.url);
    if (!response.ok) throw new Error(`B2 artifact download failed: HTTP ${response.status}`);
    blob = await response.blob();
  } else {
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (!error && data) {
    blob = data;
  } else {
    // Fallback: try signed URL in case direct download has RLS or access restrictions
    try {
      const { data: signedData } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 3600);
      if (signedData?.signedUrl) {
        const res = await fetch(signedData.signedUrl);
        if (res.ok) {
          blob = await res.blob();
        }
      }
    } catch {
      // ignore signed URL error
    }
  }

  if (!blob) {
    throw new Error(`Failed to download artifact from storage (${bucket}/${storagePath}): ${error?.message || 'Empty response or access error'}`);
  }
  }
  if (!blob) throw new Error(`Missing analysis artifact in ${bucket}/${storagePath}`);

  const jsonText = await decompressGzipBlob(blob);
  try {
    return JSON.parse(jsonText) as BackendArtifactPayload;
  } catch (err) {
    throw new Error(`Failed to parse artifact JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Cleans up stored analysis artifact from storage.
 */
export async function deleteArtifactFromStorage(
  storagePath: string,
  bucket: string = 'videos'
): Promise<void> {
  if (bucket === B2_ARTIFACT_BUCKET) {
    const { videoId, runId } = parseB2ArtifactPath(storagePath);
    await callVideoStorage({ action: 'delete-artifact', videoId, runId });
    return;
  }
  const { error } = await supabase.storage.from(bucket).remove([storagePath]);
  if (error) throw new Error(`Failed to delete artifact: ${error.message}`);
}

/**
 * Fetches the decompressed artifact directly from the running backend (if job still present in memory/backend disk).
 */
export async function fetchJobArtifactJson(jobId: string): Promise<BackendArtifactPayload> {
  const blob = await downloadJobArtifactBlob(jobId);
  const text = await decompressGzipBlob(blob);
  return JSON.parse(text) as BackendArtifactPayload;
}

/**
 * Fetches both the raw compressed artifact blob and decompressed JSON in a single network request.
 */
export async function fetchJobArtifactBlobAndJson(jobId: string): Promise<{ blob: Blob; json: BackendArtifactPayload }> {
  const blob = await downloadJobArtifactBlob(jobId);
  const text = await decompressGzipBlob(blob);
  const json = JSON.parse(text) as BackendArtifactPayload;
  return { blob, json };
}
