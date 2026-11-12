import { supabase } from '../lib/supabase';

/**
 * Read-only compatibility for analysis artifacts saved by the retired Python
 * pipeline. Browser analysis uses its own session store; these types preserve
 * historical recordings without making a localhost API request.
 *
 * Keep the on-disk JSON keys unchanged. Old reports cannot be regenerated
 * from summary metadata when the original video is unavailable.
 */
export interface LegacyFrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
  prob: number;
  class_id: number;
  class_name: string;
}

export interface LegacyFrameTrack extends LegacyFrameBox {
  track_id: number;
  dx?: number;
  dy?: number;
  speed?: number | null;
  velocity?: number | null;
  is_overspeed?: boolean;
  state?: string;
  time_since_update?: number;
  observation_type?: 'detection' | 'interpolated' | 'predicted';
  prediction_confidence?: number | null;
}

export interface LegacyFrameResult {
  frame_id: number;
  media_time: number;
  source_width: number;
  source_height: number;
  boxes: LegacyFrameBox[];
  tracks: LegacyFrameTrack[];
  detection_count: number;
}

export interface LegacyAnalysisSummary {
  total_frames: number;
  processed_frames: number;
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
  calibration?: unknown;
}

export interface LegacyAnalysisArtifact {
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
    [key: string]: unknown;
  };
  summary: LegacyAnalysisSummary;
  total_frames: number;
  frames: LegacyFrameResult[];
}

/** Binary-search stored frame timestamps. Never extrapolate a stale detection. */
export function findFrameAtMediaTime(
  frames: readonly LegacyFrameResult[],
  mediaTime: number,
  toleranceSeconds = 0.25
): LegacyFrameResult | null {
  if (!frames.length || !Number.isFinite(mediaTime) ||
    !Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) return null;

  let low = 0;
  let high = frames.length - 1;
  let bestCandidate: LegacyFrameResult | null = null;
  let bestDelta = toleranceSeconds;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const diff = frames[mid].media_time - mediaTime;
    const delta = Math.abs(diff);
    if (delta <= bestDelta) {
      bestDelta = delta;
      bestCandidate = frames[mid];
    }
    if (delta <= 0.005) return frames[mid];
    if (diff < 0) low = mid + 1;
    else high = mid - 1;
  }
  return bestCandidate;
}

async function decodeArtifact(blob: Blob): Promise<LegacyAnalysisArtifact> {
  let text: string;
  if (blob.type.includes('gzip') || blob.type.includes('octet-stream')) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot decompress a legacy gzip analysis artifact.');
    }
    text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else {
    // Existing Supabase Storage objects sometimes have no correct MIME type.
    // Inspect gzip magic bytes instead of trusting the content-type alone.
    const magic = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    const compressed = magic.length === 2 && magic[0] === 0x1f && magic[1] === 0x8b;
    if (compressed) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser cannot decompress a legacy gzip analysis artifact.');
      }
      text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else {
      text = await blob.text();
    }
  }
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object' ||
    !Array.isArray((value as LegacyAnalysisArtifact).frames)) {
    throw new Error('The stored analysis artifact has no frame data.');
  }
  return value as LegacyAnalysisArtifact;
}

/**
 * Historical video-review artifacts were saved to a Supabase Storage bucket.
 * This compatibility reader does NOT upload video or call a Python endpoint.
 * The active browser pipeline + B2 storage remain independent of this format.
 */
export async function loadArtifactFromStorage(
  storagePath: string,
  bucket = 'videos'
): Promise<LegacyAnalysisArtifact> {
  if (!storagePath || storagePath.startsWith('/') || storagePath.includes('..')) {
    throw new Error('Invalid stored artifact path.');
  }
  const storage = supabase.storage.from(bucket);
  const { data, error } = await storage.download(storagePath);
  if (data && !error) return decodeArtifact(data);
  const { data: signed, error: signedError } = await storage.createSignedUrl(storagePath, 90);
  if (signedError || !signed?.signedUrl) {
    throw new Error(error?.message || signedError?.message || 'Stored analysis artifact is not available.');
  }
  const response = await fetch(signed.signedUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Stored analysis artifact unavailable (HTTP ${response.status}).`);
  return decodeArtifact(await response.blob());
}
