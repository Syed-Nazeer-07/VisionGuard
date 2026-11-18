import type { DetectorStartup } from '../pipeline/worker/detectorProtocol';
import type { QualityFrame } from './qualityTrace';

export type FrameTiming = {
  inferenceMs: number;
  preprocessMs: number;
  modelRunMs: number;
  postprocessMs: number;
  captureMs: number;
  resultAgeMs: number;
  replayMs: number | null;
};

export function percentiles(samples: readonly number[]) {
  const values = samples.filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  const at = (q: number) => Math.round(values[Math.ceil(q * values.length) - 1] * 10) / 10;
  return { p50: at(.50), p95: at(.95) };
}

export function describeBenchmark(
  startup: DetectorStartup | null, provider: string, frames: readonly FrameTiming[],
  overlays: readonly QualityFrame[], counters: {
    presentedVideoFrames: number; droppedVideoFrames: number; busyFrames: number;
    inferenceCount: number; playMs: number; pageJsHeapStartBytes: number | null; pageJsHeapBytes: number | null;
  }
) {
  const summarize = (key: Exclude<keyof FrameTiming, 'replayMs'>) =>
    percentiles(frames.map(frame => frame[key]));
  const elapsed = counters.playMs / 1000;
  return {
    provider, crossOriginIsolated: globalThis.crossOriginIsolated,
    userAgent: navigator.userAgent, startup, ...counters,
    firstWorkerFrameMs: frames[0]?.inferenceMs ?? null,
    sampledWorkerFrames: frames.length,
    inferenceFps: elapsed > 0 ? counters.inferenceCount / elapsed : null,
    playbackFps: elapsed > 0 ? counters.presentedVideoFrames / elapsed : null,
    workerMs: summarize('inferenceMs'),
    warmWorkerMs: percentiles(frames.slice(1).map(frame => frame.inferenceMs)),
    preprocessMs: summarize('preprocessMs'), modelRunMs: summarize('modelRunMs'),
    postprocessMs: summarize('postprocessMs'), captureMs: summarize('captureMs'),
    resultAgeMs: summarize('resultAgeMs'),
    replayMs: percentiles(frames.flatMap(frame => frame.replayMs === null ? [] : [frame.replayMs])),
    overlayAgeMs: percentiles(overlays.flatMap(frame => frame.overlayAgeMs == null ? [] : [frame.overlayAgeMs]))
  };
}

export function pageJsHeapBytes() {
  return (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
}
