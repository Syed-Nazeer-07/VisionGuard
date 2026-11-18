import { captureInferenceBitmap } from '../src/services/frameCapture';
import type { DetectorEvent, DetectorProvider, DetectorRequest } from '../src/pipeline/worker/detectorProtocol';
import { replayDetections, seekFrame } from './replay';

const input = document.querySelector<HTMLInputElement>('#video-file')!;
const video = document.querySelector<HTMLVideoElement>('#video')!;

input.addEventListener('change', () => {
  if (video.src) URL.revokeObjectURL(video.src);
  const file = input.files?.[0];
  if (file) video.src = URL.createObjectURL(file);
});

Object.assign(window, {
  async benchmarkDetector({
    modelPath, provider, times, replay
  }: { modelPath: string; provider: DetectorProvider; times: number[]; replay?: { anchors: number[]; step: number } }) {
    if (video.error) throw new Error('The browser could not decode the clip: ' + video.error.message);
    if (video.readyState < 2) {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(new Error('The browser could not decode the clip.')), { once: true });
      });
    }
    const worker = new Worker(new URL('../src/workers/localTrafficWorker.ts', import.meta.url), { type: 'module' });
    const request = <T extends 'ready' | 'result'>(
      message: DetectorRequest, responseType: T, transfer: Transferable[] = []
    ): Promise<Extract<DetectorEvent, { type: T }>> =>
      new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          worker.removeEventListener('message', listener);
          worker.removeEventListener('error', onError);
        };
        const listener = ({ data }: MessageEvent<DetectorEvent>) => {
          if (data.type !== responseType && data.type !== 'error') return;
          if (message.type === 'frame' && (!('requestId' in data) || data.requestId !== message.requestId)) return;
          cleanup();
          if (data.type === 'error') reject(new Error(data.message));
          else resolve(data as Extract<DetectorEvent, { type: T }>);
        };
        const onError = (event: ErrorEvent) => {
          cleanup();
          reject(new Error(event.message));
        };
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Benchmark timed out waiting for the detector.'));
        }, 90_000);
        worker.addEventListener('message', listener);
        worker.addEventListener('error', onError);
        worker.postMessage(message, transfer);
      });
    try {
      const started = performance.now();
      const ready = await request({ type: 'init', modelPath, provider }, 'ready');
      const startupMs = performance.now() - started;
      const frames = [];
      for (const [requestId, mediaTime] of (replay?.anchors ?? times).entries()) {
        await seekFrame(video, mediaTime);
        const captureStarted = performance.now();
        const bitmap = await captureInferenceBitmap(video);
        const captureMs = performance.now() - captureStarted;
        const result = await request({
          type: 'frame', bitmap, mediaTime, requestId, generation: 0, diagnostics: true,
          sourceWidth: video.videoWidth, sourceHeight: video.videoHeight
        }, 'result', [bitmap]);
        frames.push({ width: video.videoWidth, height: video.videoHeight, captureMs, ...result, detections: result.detections ?? [] });
      }
      return {
        startupMs, ready, frames, isolated: crossOriginIsolated, userAgent: navigator.userAgent,
        ...(replay ? { replay: await replayDetections(video, frames, times, replay.step) } : {})
      };
    } finally {
      worker.terminate();
    }
  }
});
