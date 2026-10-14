# VisionGuard frame synchronization patch

This patch updates the supplied source snapshot for the frame/result synchronization issue.

## Included files

- `apps/web/src/pages/Analyze.tsx`
- `apps/web/src/pipeline/types/index.ts`
- `apps/web/src/pipeline/worker/index.ts`
- `apps/web/src/pipeline/worker/frameSync.ts` (new)
- `apps/web/src/pipeline/worker/frameSync.test.ts` (new)
- `apps/web/src/pipeline/rendering/overlay.ts`
- `apps/web/src/pipeline/rendering/overlay.test.ts`

## Main changes

- Carry `frameId` and `sourceGeneration` through inference requests, results, and inference errors.
- Match each worker result to the exact in-flight frame before releasing the lock or applying its tracks.
- Compare overlay freshness against the last presented media timestamp (and sample `currentTime` in the fallback loop), rejecting results that are too old or from the future.
- Switch uploaded finite videos to paused, frame-synchronized stepping only when inference falls materially behind; each accepted result is displayed at its source timestamp before advancing. Live cameras remain live and stale overlays are hidden rather than seeking.
- Keep velocity extrapolation disabled.
- Ensure failed/cancelled bitmap capture releases its frame lock, flushes pending tracker reset, and does not strand a synchronized step.
- Add unit tests for result identity, timestamp freshness, frame stepping, and explicit user play/pause/stop transitions.

## Validation performed on the supplied bundle

- TypeScript/TSX syntax transpilation: 41 files, zero syntax diagnostics.
- Frame-sync helper runtime checks: 19 assertions passed.

The upload is a partial source bundle: it does not include `apps/web/package.json`, the web workspace `tsconfig`, lockfile, or installed dependencies. Therefore the full `tsc -b`, Vite build, and Vitest suite could not be run from this bundle; run those in the complete VisionGuard repository before committing.
