/**
 * Request lifecycle for the single inference worker.
 *
 * Invariants:
 *  - at most one request is in flight (`busy`);
 *  - the lock is only released by the matching result, the matching failure, an explicit
 *    cancel of a request that never reached the worker, or a worker restart (stall recovery);
 *  - a result is accepted at most once, only for the current source generation, and only if it
 *    does not regress the media time of the last accepted result.
 * All timestamps are media-time seconds (the video's own clock), except `startedAt` /
 * `now`, which are wall-clock milliseconds used only for stall detection.
 */

export interface InFlightRequest<S = unknown> {
  frameId: number;
  sourceGeneration: number;
  mediaTime: number;
  startedAt: number;
  session: S;
}

export type AcceptStatus = 'accepted' | 'ignored' | 'stale-generation' | 'out-of-order';

export interface CoordinatorCounters {
  submitted: number;
  accepted: number;
  dropped: number;
  staleRejected: number;
  outOfOrderRejected: number;
  errors: number;
  consecutiveErrors: number;
  restarts: number;
}

export class InferenceCoordinator<S = unknown> {
  generation = 0;
  inflight: InFlightRequest<S> | null = null;
  lastAcceptedFrameId = 0;
  lastAcceptedMediaTime = Number.NEGATIVE_INFINITY;
  counters: CoordinatorCounters = {
    submitted: 0, accepted: 0, dropped: 0, staleRejected: 0,
    outOfOrderRejected: 0, errors: 0, consecutiveErrors: 0, restarts: 0
  };
  private nextFrameId = 0;

  get busy(): boolean {
    return this.inflight !== null;
  }

  /** Source switched or the user sought: every result captured so far is obsolete. */
  invalidate(): number {
    this.generation++;
    this.lastAcceptedMediaTime = Number.NEGATIVE_INFINITY;
    return this.generation;
  }

  /** A presented frame was skipped because the worker was busy. */
  noteDropped(): void {
    this.counters.dropped++;
  }

  /** Start a request. Returns null (caller should drop the frame) while another is in flight. */
  tryBegin(mediaTime: number, session: S, now: number): InFlightRequest<S> | null {
    if (this.inflight || !Number.isFinite(mediaTime)) return null;
    const request: InFlightRequest<S> = {
      frameId: ++this.nextFrameId,
      sourceGeneration: this.generation,
      mediaTime,
      startedAt: now,
      session
    };
    this.inflight = request;
    this.counters.submitted++;
    return request;
  }

  /** Release a request that never reached the worker (bitmap failed / became obsolete). */
  cancel(frameId: number): boolean {
    if (this.inflight?.frameId !== frameId) return false;
    this.inflight = null;
    return true;
  }

  /**
   * Settle the outstanding request with a worker result. A result for any other frame ID is
   * ignored and never touches the lock or the tracking state.
   */
  accept(
    result: { frameId: number; sourceGeneration: number; mediaTime: number },
    sessionIsCurrent: boolean
  ): { status: AcceptStatus; request: InFlightRequest<S> | null } {
    const request = this.inflight;
    if (!request || request.frameId !== result.frameId) return { status: 'ignored', request: null };
    this.inflight = null;
    this.counters.consecutiveErrors = 0;

    if (
      !sessionIsCurrent ||
      request.sourceGeneration !== this.generation ||
      result.sourceGeneration !== request.sourceGeneration
    ) {
      this.counters.staleRejected++;
      return { status: 'stale-generation', request };
    }
    if (!(result.mediaTime > this.lastAcceptedMediaTime)) {
      this.counters.outOfOrderRejected++;
      return { status: 'out-of-order', request };
    }
    this.counters.accepted++;
    this.lastAcceptedFrameId = result.frameId;
    this.lastAcceptedMediaTime = result.mediaTime;
    return { status: 'accepted', request };
  }

  /**
   * The worker reported an exception for this frame. The lock is released so the loop can
   * continue; the caller decides (via `consecutiveErrors`) whether the run should stop.
   */
  fail(frameId: number | undefined): { released: boolean; request: InFlightRequest<S> | null } {
    const request = this.inflight;
    if (frameId !== undefined && request?.frameId !== frameId) return { released: false, request: null };
    if (!request && frameId !== undefined) return { released: false, request: null };
    this.inflight = null;
    this.counters.errors++;
    this.counters.consecutiveErrors++;
    return { released: request !== null, request };
  }

  /** Milliseconds the current request has been outstanding (0 when idle). */
  inflightAgeMs(now: number): number {
    return this.inflight ? Math.max(0, now - this.inflight.startedAt) : 0;
  }

  /**
   * The worker is being terminated and replaced. Only valid when the old worker can no longer
   * produce results, so releasing the lock cannot cause overlapping computations.
   */
  recoverFromWorkerRestart(): void {
    this.inflight = null;
    this.counters.restarts++;
    this.invalidate();
  }

  /** New analysis run: counters and ordering reset, generation advanced. */
  resetForNewRun(): void {
    this.invalidate();
    this.counters = {
      submitted: 0, accepted: 0, dropped: 0, staleRejected: 0,
      outOfOrderRejected: 0, errors: 0, consecutiveErrors: 0, restarts: 0
    };
  }
}
