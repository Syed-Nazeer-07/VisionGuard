import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { Maximize2, Minimize2, Pause, Play, Settings2, Square, Volume2, VolumeX } from 'lucide-react';
import './CompositePlayer.css';

export const playbackRates = [.25, .5, .75, 1] as const;

export function playerTime(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const parts = [Math.floor(seconds / 60) % 60, seconds % 60];
  const hours = Math.floor(seconds / 3600);
  return (hours ? hours + ':' + String(parts[0]).padStart(2, '0') : parts[0]) + ':' + String(parts[1]).padStart(2, '0');
}

type Props = {
  children: ReactNode;
  frameRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  source: string;
  capture: 'camera' | 'tab' | null;
  ready: boolean;
  playing: boolean;
  analysisPaused: boolean;
  position: number;
  duration: number;
  rate: number;
  fullscreen: boolean;
  onFullscreen: () => void;
  onSeek: (seconds: number) => void;
  onRateChange: (rate: number) => void;
  onPauseAnalysis: () => void;
  onStop: () => void;
  onError: (error: string) => void;
};

export function CompositePlayer({
  children, frameRef, videoRef, source, capture, ready, playing, analysisPaused, position, duration, rate, fullscreen,
  onFullscreen, onSeek, onRateChange, onPauseAnalysis, onStop, onError,
}: Props) {
  const [showControls, setShowControls] = useState(true);
  const [sound, setSound] = useState({ muted: true, volume: 1 });
  const timer = useRef<number | undefined>(undefined);
  const settings = useRef<HTMLDetailsElement>(null);
  const canSeek = ready && Number.isFinite(duration) && duration > 0;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setSound({ muted: video.muted, volume: video.volume });
    sync();
    video.addEventListener('volumechange', sync);
    return () => video.removeEventListener('volumechange', sync);
  }, [videoRef, source, capture]);

  useEffect(() => {
    if (!playing || capture) return;
    const id = window.setTimeout(() => setShowControls(false), 2300);
    return () => { window.clearTimeout(id); window.clearTimeout(timer.current); };
  }, [playing, capture, source]);

  function reveal() {
    setShowControls(true);
    window.clearTimeout(timer.current);
    if (playing && !capture) timer.current = window.setTimeout(() => setShowControls(false), 2300);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video || !ready || capture) return;
    if (video.paused || video.ended) void video.play().catch(() => onError('Playback could not start. Try opening the source again.'));
    else video.pause();
  }

  function onFrameClick(event: MouseEvent<HTMLDivElement>) {
    if (!source || !ready || capture || event.button !== 0 || event.defaultPrevented) return;
    // Playback controls bubble through the frame; never toggle twice or
    // change playback when a user seeks, adjusts volume, or opens settings.
    if (event.target !== event.currentTarget && event.target !== videoRef.current) return;
    reveal();
    togglePlayback();
  }

  function toggleMuted() {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted && video.volume === 0) video.volume = .5;
    video.muted = !video.muted;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && settings.current?.open) {
      event.preventDefault();
      event.stopPropagation();
      settings.current.open = false;
      settings.current.querySelector<HTMLElement>('summary')?.focus();
      return;
    }
    if (event.target !== event.currentTarget || !source || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === 'f') onFullscreen();
    else if (!capture && (key === ' ' || key === 'k')) togglePlayback();
    else if (!capture && key === 'm') toggleMuted();
    else if (!capture && canSeek && ['arrowleft', 'arrowright', 'home', 'end'].includes(key)) {
      const next = key === 'home' ? 0 : key === 'end' ? duration : (videoRef.current?.currentTime ?? 0) + (key === 'arrowleft' ? -5 : 5);
      onSeek(Math.max(0, Math.min(duration, next)));
    } else return;
    event.preventDefault();
    reveal();
  }

  return <div ref={frameRef} className="vg-player-frame relative aspect-video w-full overflow-hidden"
    tabIndex={source ? 0 : undefined} role={source ? 'group' : undefined} aria-label={source ? 'Video player' : undefined}
    aria-keyshortcuts={source ? capture ? 'F' : 'Space K ArrowLeft ArrowRight Home End M F' : undefined}
    data-click-playback={Boolean(source && ready && !capture)}
    onPointerMove={reveal} onKeyDown={onKeyDown} onClick={onFrameClick}>
    {children}
    {source && <div className="vg-player-controls" data-hidden={!showControls && playing && !capture}>
      {!capture && <input className="vg-player-timeline" type="range" min="0" max={canSeek ? duration : 1} step="any"
        value={canSeek ? Math.min(position, duration) : 0} disabled={!canSeek} aria-label="Seek video"
        aria-valuetext={playerTime(position) + ' of ' + playerTime(duration)}
        style={{ '--vg-played': canSeek ? (position / duration * 100) + '%' : '0%' } as React.CSSProperties}
        onChange={event => onSeek(Number(event.target.value))}/>}
      <div className="vg-player-control-row">
        {capture ? <>
          <button type="button" onClick={onPauseAnalysis}
            title={analysisPaused ? 'Resume analysis' : 'Pause analysis'} aria-label={analysisPaused ? 'Resume analysis' : 'Pause analysis'}>
            {analysisPaused ? <Play size={18}/> : <Pause size={18}/>}
          </button>
          <span>{analysisPaused ? 'Analysis paused' : 'Live capture'}</span>
          <button className="vg-player-stop" type="button" onClick={onStop}><Square size={15}/> {capture === 'tab' ? 'Stop sharing' : 'Stop camera'}</button>
        </> : <>
          <button type="button" onClick={togglePlayback} disabled={!ready}
            title={playing ? 'Pause (K)' : 'Play (K)'} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={19}/> : <Play size={19}/>}
          </button>
          <span className="vg-player-time"><span>{playerTime(position)}</span><span> / {playerTime(duration)}</span></span>
          <div className="vg-player-volume">
            <button type="button" onClick={toggleMuted} aria-label={sound.muted ? 'Unmute' : 'Mute'}
              title={sound.muted ? 'Unmute (M)' : 'Mute (M)'}>
              {sound.muted ? <VolumeX size={18}/> : <Volume2 size={18}/>}
            </button>
            <input type="range" min="0" max="1" step=".05" value={sound.muted ? 0 : sound.volume} aria-label="Volume"
              aria-valuetext={Math.round((sound.muted ? 0 : sound.volume) * 100) + '%'}
              onChange={event => {
                const video = videoRef.current;
                if (!video) return;
                video.volume = Number(event.target.value);
                video.muted = video.volume === 0;
              }}/>
          </div>
          <details ref={settings} className="vg-player-settings">
            <summary title="Playback settings" aria-label="Playback settings"><Settings2 size={18}/></summary>
            <div>
              <fieldset>
                <legend>Playback speed</legend>
                {playbackRates.map(speed => <label key={speed}>
                  <input name="vg-playback-rate" type="radio" value={speed} checked={rate === speed} onChange={() => onRateChange(speed)}/>{speed}×
                </label>)}
              </fieldset>
              <p>Slower playback gives the detector more time per video second. Accuracy can still vary.</p>
            </div>
          </details>
        </>}
        <button type="button" className="vg-player-fullscreen" onClick={onFullscreen}
          title={fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
          {fullscreen ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}
        </button>
      </div>
    </div>}
  </div>;
}
