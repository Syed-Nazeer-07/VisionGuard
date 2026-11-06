import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { AlertCircle, Camera, Loader2 } from 'lucide-react';
import { getCameraPlaybackSource, type CameraSourceRecord } from '../../services/cameraSources';

export type CameraPlaybackState = 'playing' | 'error';

/**
 * Real media element / HLS.js player shared by Monitoring and the camera wizard.
 * The only success signal is the media element's actual 'playing' event.
 * This does not run inference, record footage or verify long-term availability.
 */
export function CameraStream({
  camera,
  onPlayback,
  controls = false,
}: {
  camera: CameraSourceRecord;
  onPlayback?: (state: CameraPlaybackState, reason?: string) => void;
  controls?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const notifyRef = useRef(onPlayback);
  notifyRef.current = onPlayback;
  const [state, setState] = useState<'loading' | 'playing' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const playback = getCameraPlaybackSource(camera);
  const url = playback.playable ? playback.url : null;
  const reason = playback.playable ? null : playback.reason;

  useEffect(() => {
    if (!url) return;
    setState('loading');
    setMessage(null);
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const error = (text: string) => {
      if (disposed) return;
      setState('error');
      setMessage(text);
      notifyRef.current?.('error', text);
    };
    const playing = () => {
      if (disposed) return;
      if (timeout) { clearTimeout(timeout); timeout = null; }
      setState('playing');
      setMessage(null);
      notifyRef.current?.('playing');
    };
    const attemptPlay = () => {
      void video.play().catch(() => {
        // Autoplay may be blocked. Controls remain available for a user gesture.
        if (!disposed) setMessage('Playback requires a click on the video controls.');
      });
    };
    const mediaError = () => error('Stream playback failed. Check the manifest, CORS, codecs and network.');
    video.addEventListener('playing', playing);
    video.addEventListener('error', mediaError);
    timeout = setTimeout(() => error('Stream did not start within 15 seconds. Check network access and CORS.'), 15000);

    try {
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: false, lowLatencyMode: true });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) error(`HLS playback error: ${data.details}`);
        });
        hls.on(Hls.Events.MANIFEST_PARSED, attemptPlay);
        hls.attachMedia(video);
        hls.loadSource(url);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.load();
        attemptPlay();
      } else {
        error('HLS playback is unavailable in this browser.');
      }
    } catch (e) {
      error(e instanceof Error ? e.message : 'Could not initialize the HLS player.');
    }

    return () => {
      disposed = true;
      if (timeout) clearTimeout(timeout);
      video.removeEventListener('playing', playing);
      video.removeEventListener('error', mediaError);
      video.pause();
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [url]);

  if (!url) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center gap-2 bg-slate-900 p-5 text-slate-300">
        <Camera className="w-8 h-8 opacity-50" />
        <p className="text-xs max-w-sm">{reason}</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-slate-950">
      <video ref={videoRef} className="w-full h-full object-contain" muted playsInline autoPlay controls={controls || state === 'error'} />
      {state === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-slate-200 bg-black/30 text-xs">
          <Loader2 className="w-4 h-4 animate-spin" /> Connecting to HLS feed…
        </div>
      )}
      {(state === 'error' || message) && (
        <div className="absolute bottom-2 left-2 right-2 flex items-start gap-2 bg-slate-950/90 border border-amber-600/50 text-amber-100 text-xs p-2 rounded">
          <AlertCircle className="w-4 h-4 shrink-0" /> {message || 'Playback unavailable'}
        </div>
      )}
    </div>
  );
}
