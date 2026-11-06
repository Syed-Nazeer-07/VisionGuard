import { describe, expect, it } from 'vitest';
import { cameraFrameDecision, CAMERA_INFERENCE_FLAGS, liveModelPreflightResponse } from './cameraInferencePolicy';

const frame = {
  running: true, modelReady: true, playing: true, hasFrame: true,
  workerBusy: false, timestampSeconds: 123.5, lastSubmittedTimeSeconds: 123.4
};

describe('safe HLS camera frame scheduling', () => {
  it('submits only a new decoded frame during active playback', () => {
    expect(cameraFrameDecision(frame)).toBe('submit');
    expect(cameraFrameDecision({ ...frame, timestampSeconds: 123.4 })).toBe('skip');
    expect(cameraFrameDecision({ ...frame, timestampSeconds: NaN })).toBe('skip');
    expect(cameraFrameDecision({ ...frame, modelReady: false })).toBe('skip');
    expect(cameraFrameDecision({ ...frame, playing: false })).toBe('skip');
    expect(cameraFrameDecision({ ...frame, running: false })).toBe('skip');
    expect(cameraFrameDecision({ ...frame, hasFrame: false })).toBe('skip');
  });
  it('drops a frame when the worker is busy rather than overlapping inference', () => {
    expect(cameraFrameDecision({ ...frame, workerBusy: true })).toBe('drop');
  });
  it('keeps all traffic-rule and plate side effects disabled', () => {
    expect(Object.values(CAMERA_INFERENCE_FLAGS).every(enabled => !enabled)).toBe(true);
  });
  it('reports a missing ONNX model and HTML SPA fallback as unavailable', () => {
    expect(liveModelPreflightResponse(false, 'text/html', 404)).toContain('ONNX model');
    expect(liveModelPreflightResponse(true, 'text/html', 200)).toContain('ONNX model');
    expect(liveModelPreflightResponse(true, 'application/octet-stream', 200)).toBeNull();
  });
});
