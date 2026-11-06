import { describe, expect, it } from 'vitest';
import { artifactLocationForRun, runScopedTrackUpsertOptions } from './runTrackIdentity';

describe('run-scoped tracking identity', () => {
  it('uses analysis_run_id,track_id instead of video_id,track_id', () => {
    expect(runScopedTrackUpsertOptions([
      { analysis_run_id: 'run-a', track_id: 1 },
      { analysis_run_id: 'run-a', track_id: 2 }
    ], 'run-a')).toEqual({ onConflict: 'analysis_run_id,track_id' });
    expect(runScopedTrackUpsertOptions([
      { analysis_run_id: 'run-b', track_id: 1 }
    ], 'run-b')).toEqual({ onConflict: 'analysis_run_id,track_id' });
  });
  it('rejects mixing tracks from different runs', () => {
    expect(() => runScopedTrackUpsertOptions([
      { analysis_run_id: 'run-a', track_id: 1 },
      { analysis_run_id: 'run-b', track_id: 2 }
    ], 'run-a')).toThrow('different analysis run');
  });
  it('rejects duplicate or invalid identifiers', () => {
    expect(() => runScopedTrackUpsertOptions([], '')).toThrow('run ID');
    expect(() => runScopedTrackUpsertOptions([
      { analysis_run_id: 'run-a', track_id: 1 },
      { analysis_run_id: 'run-a', track_id: 1 }
    ], 'run-a')).toThrow('Duplicate track');
    expect(() => runScopedTrackUpsertOptions([
      { analysis_run_id: 'run-a', track_id: 0 }
    ], 'run-a')).toThrow('positive integer');
    expect(() => runScopedTrackUpsertOptions([
      { analysis_run_id: null, track_id: 1 }
    ], 'run-a')).toThrow('different analysis run');
  });
});

describe('review artifact isolation', () => {
  it('selects only the requested run artifact', () => {
    const a = { metrics: { artifact_storage_path: 'artifacts/video/run-a.json.gz', artifact_bucket: 'videos' } };
    const b = { metrics: { artifact_storage_path: 'artifacts/video/run-b.json.gz', artifact_bucket: 'evidence' } };
    expect(artifactLocationForRun(a)).toEqual({ path: 'artifacts/video/run-a.json.gz', bucket: 'videos' });
    expect(artifactLocationForRun(b)).toEqual({ path: 'artifacts/video/run-b.json.gz', bucket: 'evidence' });
  });
  it('returns no artifact for a browser-only run without an artifact pointer', () => {
    expect(artifactLocationForRun({ metrics: { frames_processed: 12 } })).toBeNull();
    expect(artifactLocationForRun({ metrics: null })).toBeNull();
  });
});
