/**
 * Browser camera playback is currently HLS-only. RTSP and YouTube streams
 * require a real gateway/ingestion service; checking a URL's prefix does NOT
 * prove the camera is online or that inference is running.
 */
export interface CameraSourceRecord {
  source_type?: string | null;
  source_url?: string | null;
  stream_url?: string | null;
}
export type CameraPlaybackSource =
  | { playable: true; url: string; type: 'hls' }
  | { playable: false; reason: string };

export function getCameraPlaybackSource(camera: CameraSourceRecord | null | undefined): CameraPlaybackSource {
  if (!camera) return { playable: false, reason: 'No camera selected.' };
  const type = (camera.source_type || '').toLowerCase();
  const raw = (camera.source_url || camera.stream_url || '').trim();
  if (!raw) return { playable: false, reason: 'No stream URL configured.' };
  if (type === 'rtsp') {
    return { playable: false, reason: 'RTSP needs a configured RTSP-to-HLS/WebRTC gateway. Direct browser playback is unavailable.' };
  }
  if (type === 'youtube_live') {
    return { playable: false, reason: 'YouTube Live ingestion is not implemented. A verified server-side ingestion gateway is required.' };
  }
  if (type === 'uploaded_video') {
    return { playable: false, reason: 'Uploaded-video camera simulation is not implemented. Use Video Analysis for stored clips.' };
  }
  if (type && type !== 'hls') {
    return { playable: false, reason: 'This camera source type is not supported by the browser player.' };
  }
  let parsed: URL;
  try { parsed = new URL(raw); }
  catch { return { playable: false, reason: 'Invalid HLS URL.' }; }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    return { playable: false, reason: 'Use an HTTP(S) HLS URL without embedded credentials.' };
  }
  if (!parsed.pathname.toLowerCase().endsWith('.m3u8')) {
    return { playable: false, reason: 'HLS URL must point to an .m3u8 manifest.' };
  }
  return { playable: true, url: parsed.toString(), type: 'hls' };
}

export function cameraSourceLabel(camera: CameraSourceRecord): string {
  const type = camera.source_type || 'unknown';
  return type.replaceAll('_', ' ').toUpperCase();
}

/** Never display query tokens, passwords or full credential-bearing stream URLs. */
export function cameraSourceHost(camera: CameraSourceRecord): string {
  const value = camera.source_url || camera.stream_url;
  if (!value) return 'Not configured';
  try { return new URL(value).host || 'Configured'; }
  catch { return 'Configured (invalid URL)'; }
}

/** Select unique camera tiles. A 2×2 grid with one configured camera must not
 * present the same stream as four independent active cameras. */
export function selectCameraTiles<T extends { id: string }>(
  cameras: readonly T[], selectedId: string | null, slots: 1 | 4 | 9
): T[] {
  const seen = new Set<string>();
  const unique = cameras.filter(cam => {
    if (seen.has(cam.id)) return false;
    seen.add(cam.id);
    return true;
  });
  const chosen = unique.find(cam => cam.id === selectedId);
  return (chosen ? [chosen, ...unique.filter(cam => cam.id !== chosen.id)] : unique).slice(0, slots);
}
