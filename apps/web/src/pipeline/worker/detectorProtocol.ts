import type { BoundingBox } from '../types';
import type { LiveTrack } from '../tracker/liveProjection';

export type DetectorProvider = 'auto' | 'wasm';
export type DetectorStartup = {
  downloadMs: number;
  modelBytes: number;
  adapterMs: number;
  runtimeImportMs: number;
  sessionMs: number;
  validationMs: number;
  wasmThreads?: number;
  adapter?: { vendor?: string; architecture?: string; device?: string; description?: string };
};

export type DetectorFrame = {
  type: 'frame';
  bitmap: ImageBitmap;
  mediaTime: number;
  generation: number;
  sourceWidth: number;
  sourceHeight: number;
  requestId: number;
  preview?: boolean;
  diagnostics?: boolean;
};

export type DetectorRequest =
  | { type: 'init'; modelPath: string; provider?: DetectorProvider }
  | { type: 'reset' }
  | DetectorFrame;

export type DetectorEvent =
  | { type: 'loading'; stage: 'downloading' | 'initializing' }
  | { type: 'progress'; receivedBytes: number; totalBytes: number | null }
  | { type: 'ready'; provider: string; fallbackReason?: string; startup: DetectorStartup }
  | {
      type: 'result'; requestId: number; generation: number; mediaTime: number; tracks: LiveTrack[];
      detectionCount: number; inferenceMs: number; provider: string; detections?: BoundingBox[];
      preprocessMs: number; modelRunMs: number; postprocessMs: number;
    }
  | { type: 'skipped'; requestId: number; generation: number }
  | { type: 'error'; requestId: number; generation: number; message: string };
