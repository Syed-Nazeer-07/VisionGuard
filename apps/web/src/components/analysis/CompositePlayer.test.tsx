import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { CompositePlayer } from './CompositePlayer';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function mountPlayer(capture: 'camera' | 'tab' | null = null, ready = true) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const frameRef = { current: null as HTMLDivElement | null };
  const videoRef = { current: null as HTMLVideoElement | null };
  const onPauseAnalysis = vi.fn();
  act(() => root.render(<CompositePlayer frameRef={frameRef} videoRef={videoRef}
    source="/sample.mp4" capture={capture} ready={ready} playing={false}
    analysisPaused={false} position={0} duration={19} rate={1} fullscreen={false}
    onFullscreen={vi.fn()} onSeek={vi.fn()} onRateChange={vi.fn()}
    onPauseAnalysis={onPauseAnalysis} onStop={vi.fn()} onError={vi.fn()}>
    <video ref={videoRef}/>
  </CompositePlayer>));
  const video = videoRef.current!;
  let paused = true;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  const play = vi.spyOn(video, 'play').mockImplementation(async () => { paused = false; });
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => { paused = true; });
  const click = (element: Element) => act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  });
  return { host, video, play, pause, click, onPauseAnalysis, dispose: () => {
    act(() => root.unmount());
    host.remove();
  }};
}

describe('CompositePlayer surface playback', () => {
  it('plays and pauses a recording with a single click on its video surface', () => {
    const p = mountPlayer();
    try {
      p.click(p.video);
      expect(p.play).toHaveBeenCalledTimes(1);
      p.click(p.video);
      expect(p.pause).toHaveBeenCalledTimes(1);
    } finally { p.dispose(); }
  });
  it('does not double-toggle or toggle playback via unrelated controls', () => {
    const p = mountPlayer();
    try {
      p.click(p.host.querySelector('button[aria-label="Play"]')!);
      expect(p.play).toHaveBeenCalledTimes(1);
      expect(p.pause).not.toHaveBeenCalled();
      p.click(p.host.querySelector('input[aria-label="Seek video"]')!);
      p.click(p.host.querySelector('summary')!);
      p.click(p.host.querySelector('button[aria-label="Enter fullscreen"]')!);
      expect(p.play).toHaveBeenCalledTimes(1);
      expect(p.pause).not.toHaveBeenCalled();
    } finally { p.dispose(); }
  });
  it.each(['camera', 'tab'] as const)('does not pause the %s live stream on surface click', capture => {
    const p = mountPlayer(capture);
    try {
      p.click(p.video);
      expect(p.play).not.toHaveBeenCalled();
      expect(p.pause).not.toHaveBeenCalled();
      expect(p.onPauseAnalysis).not.toHaveBeenCalled();
    } finally { p.dispose(); }
  });
  it('ignores clicks before a video is ready', () => {
    const p = mountPlayer(null, false);
    try {
      p.click(p.video);
      expect(p.play).not.toHaveBeenCalled();
      expect(p.pause).not.toHaveBeenCalled();
    } finally { p.dispose(); }
  });
});
