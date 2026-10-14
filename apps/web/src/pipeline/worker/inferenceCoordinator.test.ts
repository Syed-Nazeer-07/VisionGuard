import { describe, expect, it } from 'vitest';
import { InferenceCoordinator } from './inferenceCoordinator';
import type { ResultMessage } from '../types';

function makeResult(partial: Partial<ResultMessage> = {}): ResultMessage {
  return {
    type: 'result',
    frameId: 1,
    sourceGeneration: 0,
    mediaTime: 1.0,
    tracks: [],
    boxes: [],
    violations: [],
    inferenceTime: 30,
    sourceWidth: 1920,
    sourceHeight: 1080,
    detectionCount: 0,
    provider: 'webgpu',
    ...partial,
  };
}

describe('InferenceCoordinator', () => {
  it('enforces single in-flight request', () => {
    const coord = new InferenceCoordinator<string>();
    expect(coord.busy).toBe(false);

    const req1 = coord.tryBegin(1.0, 'session-1', 1000);
    expect(req1).not.toBeNull();
    expect(req1?.frameId).toBe(1);
    expect(coord.busy).toBe(true);

    // Second request while busy must return null
    const req2 = coord.tryBegin(1.04, 'session-1', 1040);
    expect(req2).toBeNull();
    expect(coord.counters.submitted).toBe(1);
  });

  it('releases lock and counts errors on failure', () => {
    const coord = new InferenceCoordinator<string>();
    const req = coord.tryBegin(1.0, 'session-1', 1000);
    expect(coord.busy).toBe(true);

    const { released, request } = coord.fail(req?.frameId);
    expect(released).toBe(true);
    expect(request).toBe(req);
    expect(coord.busy).toBe(false);
    expect(coord.counters.errors).toBe(1);
    expect(coord.counters.consecutiveErrors).toBe(1);

    // Next request can now begin
    const nextReq = coord.tryBegin(1.08, 'session-1', 1080);
    expect(nextReq).not.toBeNull();
  });

  it('resets consecutive errors on accepted result', () => {
    const coord = new InferenceCoordinator<string>();
    coord.tryBegin(1.0, 'session-1', 1000);
    coord.fail(1);
    expect(coord.counters.consecutiveErrors).toBe(1);

    const req2 = coord.tryBegin(1.05, 'session-1', 1050);
    const res = coord.accept(makeResult({ frameId: req2!.frameId, sourceGeneration: req2!.sourceGeneration, mediaTime: 1.05 }), true);
    expect(res.status).toBe('accepted');
    expect(coord.counters.consecutiveErrors).toBe(0);
    expect(coord.counters.accepted).toBe(1);
    expect(coord.busy).toBe(false);
  });

  it('ignores results with unknown frameId without releasing lock', () => {
    const coord = new InferenceCoordinator<string>();
    coord.tryBegin(1.0, 'session-1', 1000);
    expect(coord.busy).toBe(true);

    const res = coord.accept(makeResult({ frameId: 999, sourceGeneration: 0, mediaTime: 1.0 }), true);
    expect(res.status).toBe('ignored');
    expect(coord.busy).toBe(true); // lock preserved
  });

  it('rejects results from stale generations after seek or source change', () => {
    const coord = new InferenceCoordinator<string>();
    const req = coord.tryBegin(1.0, 'session-1', 1000);
    expect(req?.sourceGeneration).toBe(0);

    // Seek occurred: invalidate coordinator
    coord.invalidate();
    expect(coord.generation).toBe(1);

    const res = coord.accept(makeResult({ frameId: req!.frameId, sourceGeneration: 0, mediaTime: 1.0 }), true);
    expect(res.status).toBe('stale-generation');
    expect(coord.counters.staleRejected).toBe(1);
    expect(coord.busy).toBe(false); // lock released so new frame can be submitted
  });

  it('rejects out-of-order results that regress mediaTime', () => {
    const coord = new InferenceCoordinator<string>();
    const req1 = coord.tryBegin(2.0, 'session-1', 1000);
    coord.accept(makeResult({ frameId: req1!.frameId, sourceGeneration: 0, mediaTime: 2.0 }), true);
    expect(coord.lastAcceptedMediaTime).toBe(2.0);

    // Next request returns a timestamp in the past
    const req2 = coord.tryBegin(1.5, 'session-1', 1100);
    const res = coord.accept(makeResult({ frameId: req2!.frameId, sourceGeneration: 0, mediaTime: 1.5 }), true);
    expect(res.status).toBe('out-of-order');
    expect(coord.counters.outOfOrderRejected).toBe(1);
    expect(coord.busy).toBe(false);
  });

  it('handles worker stall recovery and ignores late results', () => {
    const coord = new InferenceCoordinator<string>();
    coord.tryBegin(1.0, 'session-1', 1000);
    expect(coord.busy).toBe(true);
    expect(coord.generation).toBe(0);

    coord.recoverFromWorkerRestart();
    expect(coord.busy).toBe(false);
    expect(coord.generation).toBe(1); // invalidates previous generation
    expect(coord.counters.restarts).toBe(1);

    // Late result from crashed worker arrives: ignored because request is no longer inflight
    const res = coord.accept(makeResult({ frameId: 1, sourceGeneration: 0, mediaTime: 1.0 }), true);
    expect(res.status).toBe('ignored');

    // New request starts under new generation
    const newReq = coord.tryBegin(2.0, 'session-1', 2000);
    expect(newReq?.sourceGeneration).toBe(1);
    expect(coord.busy).toBe(true);

    // Late result from frame 1 still ignored
    expect(coord.accept(makeResult({ frameId: 1, sourceGeneration: 0, mediaTime: 1.0 }), true).status).toBe('ignored');
    expect(coord.busy).toBe(true); // newReq still inflight
  });

  it('counts dropped frames and resets for new run', () => {
    const coord = new InferenceCoordinator<string>();
    coord.noteDropped();
    coord.noteDropped();
    expect(coord.counters.dropped).toBe(2);

    coord.resetForNewRun();
    expect(coord.counters.dropped).toBe(0);
    expect(coord.counters.submitted).toBe(0);
    expect(coord.counters.accepted).toBe(0);
    expect(coord.busy).toBe(false);
  });
});
