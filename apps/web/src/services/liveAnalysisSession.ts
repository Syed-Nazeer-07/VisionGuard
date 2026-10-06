/**
 * Active Live Analysis source for this browser tab.
 *
 * Module-level, in-memory on purpose:
 *   - survives SPA navigation (Analyze unmounts/remounts; this module does not)
 *   - is reset by a full page refresh (nothing is written to localStorage/sessionStorage)
 *
 * `mode` is authoritative: in 'uploaded-video' mode `videoId` is the source; in 'camera' mode
 * `cameraId` is. Switching to a camera keeps `videoId`, so the uploaded video can be restored.
 * The video_assets row and its stored file are never touched here.
 */
export type LiveSourceMode = 'uploaded-video' | 'camera'

export interface LiveAnalysisSource {
  readonly mode: LiveSourceMode
  readonly videoId: string | null
  /** Display name of the retained video (e.g. "Video 15"), filled in once its row is loaded. */
  readonly videoLabel: string | null
  readonly cameraId: string | null
}

type Listener = () => void

let state: LiveAnalysisSource = { mode: 'uploaded-video', videoId: null, videoLabel: null, cameraId: null }
const listeners = new Set<Listener>()

function update(next: LiveAnalysisSource) {
  if (next.mode === state.mode && next.videoId === state.videoId && next.videoLabel === state.videoLabel && next.cameraId === state.cameraId) return
  state = next
  listeners.forEach(l => l())
}

export const liveAnalysisSession = {
  /** Snapshot (stable reference until the next change) — usable with useSyncExternalStore. */
  get(): LiveAnalysisSource {
    return state
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  /** Make an uploaded/library video the active source. */
  selectVideo(videoId: string) {
    update({ ...state, mode: 'uploaded-video', videoId, videoLabel: videoId === state.videoId ? state.videoLabel : null })
  },
  setVideoLabel(videoId: string, label: string) {
    if (state.videoId === videoId) update({ ...state, videoLabel: label })
  },
  /** Return to uploaded-video mode, restoring the retained video (if any). */
  showUploadedVideo() {
    update({ ...state, mode: 'uploaded-video' })
  },
  /** Camera mode; the uploaded video stays retained. `null` = camera mode with no camera chosen yet. */
  selectCamera(cameraId: string | null) {
    update({ ...state, mode: 'camera', cameraId })
  },
  /** Drop the active uploaded video from Live Analysis (the asset itself is kept). */
  clearVideo() {
    update({ ...state, mode: 'uploaded-video', videoId: null, videoLabel: null })
  },
}

export function sourceKeyOf(source: LiveAnalysisSource): string {
  if (source.mode === 'uploaded-video') return source.videoId ? `video:${source.videoId}` : ''
  return source.cameraId ? `camera:${source.cameraId}` : ''
}
