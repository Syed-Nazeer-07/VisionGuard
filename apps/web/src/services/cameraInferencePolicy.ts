import type { FeatureFlags } from '../pipeline/types';

/** Inference-only live preview. Never silently enable uncalibrated traffic rules. */
export const CAMERA_MODEL_PATH = '/models/yolo11n.onnx';
export const CAMERA_INFERENCE_FLAGS: Readonly<FeatureFlags> = Object.freeze({
  speed_detection: false,
  red_light_detection: false,
  lane_detection: false,
  helmet_detection: false,
  triple_riding_detection: false,
  plate_detection: false,
});

export type FrameGateDecision = 'submit' | 'drop' | 'skip';

/** A live frame uses a monotonic *presentation-time* timestamp, not HLS
 * mediaTime (which can jump backward when streams have discontinuities).
 * Skipped and busy frames never create extra tracker updates. */
export function cameraFrameDecision(args: {
  running: boolean;
  modelReady: boolean;
  playing: boolean;
  hasFrame: boolean;
  workerBusy: boolean;
  timestampSeconds: number;
  lastSubmittedTimeSeconds: number;
}): FrameGateDecision {
  if (!args.running || !args.modelReady || !args.playing || !args.hasFrame
      || !Number.isFinite(args.timestampSeconds)
      || args.timestampSeconds <= args.lastSubmittedTimeSeconds) return 'skip';
  return args.workerBusy ? 'drop' : 'submit';
}

export function liveModelPreflightResponse(
  ok: boolean, contentType: string | null, status: number
): string | null {
  if (!ok || (contentType || '').toLowerCase().includes('text/html')) {
    return `YOLO ONNX model is unavailable at ${CAMERA_MODEL_PATH} (HTTP ${status}). Obtain a licensed compatible model and place it in the web app's public/models directory.`;
  }
  return null;
}
