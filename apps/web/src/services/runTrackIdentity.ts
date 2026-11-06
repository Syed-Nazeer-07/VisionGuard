/**
 * Tracker IDs are generated afresh for each inference run. Never use the
 * source video or camera ID as an upsert conflict target: that overwrites
 * a different run's history when its tracker reuses the same numeric ID.
 */
export const RUN_TRACK_CONFLICT = 'analysis_run_id,track_id' as const;

export interface RunTrackKey {
  analysis_run_id: string | null;
  track_id: number;
}

/**
 * Check that the entire batch belongs to one run and contains unique IDs.
 * The database's matching UNIQUE constraint is still the source of truth.
 */
export function runScopedTrackUpsertOptions(
  rows: ReadonlyArray<RunTrackKey>,
  runId: string
): { onConflict: typeof RUN_TRACK_CONFLICT } {
  if (!runId) throw new Error('A persisted analysis run ID is required for tracked objects');
  const seen = new Set<number>();
  for (const row of rows) {
    if (row.analysis_run_id !== runId) {
      throw new Error('Refusing to persist a track under a different analysis run');
    }
    if (!Number.isSafeInteger(row.track_id) || row.track_id < 1) {
      throw new Error('Track ID must be a positive integer');
    }
    if (seen.has(row.track_id)) {
      throw new Error(`Duplicate track #${row.track_id} in one analysis batch`);
    }
    seen.add(row.track_id);
  }
  return { onConflict: RUN_TRACK_CONFLICT };
}

/** Read an artifact by the selected run, never by the video's latest metadata.
 * A stale video-level pointer may belong to a completely different run.
 */
export function artifactLocationForRun(run: { metrics?: unknown } | null | undefined): {
  path: string;
  bucket: string;
} | null {
  if (!run?.metrics || typeof run.metrics !== 'object' || Array.isArray(run.metrics)) {
    return null;
  }
  const metrics = run.metrics as Record<string, unknown>;
  const path = metrics.artifact_storage_path;
  if (typeof path !== 'string' || !path.trim()) return null;
  const bucket = typeof metrics.artifact_bucket === 'string' && metrics.artifact_bucket.trim()
    ? metrics.artifact_bucket : 'videos';
  return { path, bucket };
}
