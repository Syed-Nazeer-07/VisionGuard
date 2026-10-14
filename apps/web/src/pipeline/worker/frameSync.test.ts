import { describe, expect, it } from 'vitest';
import {
  isOverlayTimestampFresh,
  isOverlayAgeFresh,
  computeResultAge,
  matchesFrameRequest,
  canSubmitContinuousFrame,
  shouldStopAfterInferenceErrors,
  isWorkerStalled,
  diagnosePipeline,
  MAX_OVERLAY_AGE_SECONDS,
  WORKER_STALL_RESTART_MS,
  MAX_CONSECUTIVE_INFERENCE_ERRORS,
} from './frameSync';

describe('frame timestamp synchronization and age', () => {
  it('accepts a recent result during continuous playback', () => {
    expect(isOverlayTimestampFresh(12.04, 12.01)).toBe(true);
    expect(isOverlayTimestampFresh(12.2, 12.01)).toBe(true);
    expect(isOverlayTimestampFresh(12.45, 12.01)).toBe(true);
  });

  it('rejects results that are too old to describe the displayed frame', () => {
    expect(isOverlayTimestampFresh(12.6, 12.01)).toBe(false);
    expect(isOverlayTimestampFresh(13.5, 12.01)).toBe(false);
  });

  it('rejects a result from the future after a backward seek', () => {
    expect(isOverlayTimestampFresh(8, 12)).toBe(false);
  });

  it('computes accurate result age in media time', () => {
    expect(computeResultAge(15.5, 15.2)).toBeCloseTo(0.3);
    expect(computeResultAge(Number.NaN, 15.2)).toBeNaN();
    expect(computeResultAge(15.5, Number.NaN)).toBeNaN();
  });

  it('validates freshness based on age', () => {
    expect(isOverlayAgeFresh(0.2, MAX_OVERLAY_AGE_SECONDS)).toBe(true);
    expect(isOverlayAgeFresh(0.6, MAX_OVERLAY_AGE_SECONDS)).toBe(false);
    expect(isOverlayAgeFresh(-0.01, MAX_OVERLAY_AGE_SECONDS)).toBe(true);
    expect(isOverlayAgeFresh(-0.05, MAX_OVERLAY_AGE_SECONDS)).toBe(false); // future skew
  });
});

describe('worker result identity and continuous flow', () => {
  it('accepts only the exact outstanding frame response', () => {
    expect(matchesFrameRequest(41, 41)).toBe(true);
    expect(matchesFrameRequest(41, 40)).toBe(false);
    expect(matchesFrameRequest(null, 41)).toBe(false);
    expect(matchesFrameRequest(41, undefined)).toBe(false);
  });

  it('governs continuous frame submission without pausing video playback', () => {
    // When analyzing, video playing, and worker idle -> submit frame
    expect(canSubmitContinuousFrame(false, false, 'ANALYZING')).toBe(true);
    // When worker is busy -> drop frame, do not submit
    expect(canSubmitContinuousFrame(true, false, 'ANALYZING')).toBe(false);
    // When paused or stopped -> do not submit
    expect(canSubmitContinuousFrame(false, true, 'ANALYZING')).toBe(false);
    expect(canSubmitContinuousFrame(false, false, 'PAUSED')).toBe(false);
    expect(canSubmitContinuousFrame(false, false, 'STOPPED')).toBe(false);
  });

  it('determines when to stop after consecutive inference errors', () => {
    expect(shouldStopAfterInferenceErrors(1)).toBe(false);
    expect(shouldStopAfterInferenceErrors(MAX_CONSECUTIVE_INFERENCE_ERRORS - 1)).toBe(false);
    expect(shouldStopAfterInferenceErrors(MAX_CONSECUTIVE_INFERENCE_ERRORS)).toBe(true);
    expect(shouldStopAfterInferenceErrors(MAX_CONSECUTIVE_INFERENCE_ERRORS + 1)).toBe(true);
  });

  it('detects stalled workers based on request elapsed time', () => {
    expect(isWorkerStalled(1000, WORKER_STALL_RESTART_MS)).toBe(false);
    expect(isWorkerStalled(WORKER_STALL_RESTART_MS, WORKER_STALL_RESTART_MS)).toBe(true);
    expect(isWorkerStalled(WORKER_STALL_RESTART_MS + 500, WORKER_STALL_RESTART_MS)).toBe(true);
  });

  it('diagnoses pipeline health accurately', () => {
    expect(diagnosePipeline({
      workerBusyMs: WORKER_STALL_RESTART_MS + 100,
      latencyMs: 50,
      resultAgeSeconds: 0.1,
      detectionCount: 5,
      trackCount: 5,
      renderedTracks: 5,
      workerErrors: 0,
    })).toBe('worker stalled');

    expect(diagnosePipeline({
      workerBusyMs: 100,
      latencyMs: 300, // > 0.5/2 = 0.25s
      resultAgeSeconds: 0.1,
      detectionCount: 5,
      trackCount: 5,
      renderedTracks: 5,
      workerErrors: 0,
    })).toBe('insufficient inference throughput');

    expect(diagnosePipeline({
      workerBusyMs: 100,
      latencyMs: 50,
      resultAgeSeconds: 0.8, // > 0.5s
      detectionCount: 5,
      trackCount: 5,
      renderedTracks: 0,
      workerErrors: 0,
    })).toBe('overlay stale');

    expect(diagnosePipeline({
      workerBusyMs: 100,
      latencyMs: 50,
      resultAgeSeconds: 0.1,
      detectionCount: 0,
      trackCount: 0,
      renderedTracks: 0,
      workerErrors: 0,
    })).toBe('detector returned no objects');

    expect(diagnosePipeline({
      workerBusyMs: 100,
      latencyMs: 50,
      resultAgeSeconds: 0.1,
      detectionCount: 3,
      trackCount: 3,
      renderedTracks: 0,
      workerErrors: 0,
    })).toBe('renderer/transform issue');

    expect(diagnosePipeline({
      workerBusyMs: 100,
      latencyMs: 50,
      resultAgeSeconds: 0.1,
      detectionCount: 3,
      trackCount: 3,
      renderedTracks: 3,
      workerErrors: 0,
    })).toBe('healthy');
  });
});
