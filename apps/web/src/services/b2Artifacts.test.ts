import { afterEach, describe, expect, it, vi } from 'vitest';

const b2Action = vi.hoisted(() => vi.fn());
vi.mock('./videoStorage', () => ({ callVideoStorage: b2Action }));
import {
  B2_ARTIFACT_BUCKET,
  loadArtifactFromStorage,
  parseB2ArtifactPath,
  saveArtifactToStorage
} from './backendAnalysis';

const videoId = '01234567-89ab-cdef-0123-456789abcdef';
const runId = '12345678-1234-1234-1234-123456789abc';
const key = `artifacts/${videoId}/${runId}.json.gz`;

afterEach(() => {
  vi.unstubAllGlobals();
  b2Action.mockReset();
});

describe('Backblaze B2 analysis artifact transport', () => {
  it('accepts only video and run UUIDs, never arbitrary B2 paths', () => {
    expect(parseB2ArtifactPath(key)).toEqual({ videoId, runId });
    expect(() => parseB2ArtifactPath('../private/secret.json.gz')).toThrow('Invalid B2');
    expect(() => parseB2ArtifactPath(`artifacts/${videoId}/../other.json.gz`)).toThrow('Invalid B2');
  });

  it('uploads and verifies new backend artifacts in B2, not Supabase Storage', async () => {
    const blob = new Blob(['compressed-artifact'], { type: 'application/gzip' });
    b2Action.mockImplementation(async (body: Record<string, unknown>) => {
      if (body.action === 'create-artifact-upload') return { key, url: 'https://example.com/b2/put' };
      if (body.action === 'verify-artifact-upload') return { key, size: blob.size, exists: true };
      throw new Error('Unexpected action');
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await saveArtifactToStorage(videoId, runId, blob)).toEqual({
      storagePath: key, bucket: B2_ARTIFACT_BUCKET, size: blob.size
    });
    expect(b2Action).toHaveBeenCalledWith({
      action: 'create-artifact-upload', videoId, runId, fileSize: blob.size
    });
    expect(b2Action).toHaveBeenCalledWith({
      action: 'verify-artifact-upload', videoId, runId, fileSize: blob.size
    });
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/b2/put', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/gzip' },
      body: blob
    });
  });

  it('rejects a missing or mismatched B2 verification result', async () => {
    const blob = new Blob(['artifact']);
    b2Action.mockImplementation(async (body: Record<string, unknown>) =>
      body.action === 'create-artifact-upload'
        ? { key, url: 'https://example.com/b2/put' }
        : { key, size: 1, exists: true }
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
    await expect(saveArtifactToStorage(videoId, runId, blob)).rejects.toThrow('failed to verify');
  });

  it('loads authorized run-specific artifacts via a signed URL without Supabase Storage', async () => {
    const payload = {
      version: '1.1',
      job_id: 'job-1',
      frames: [],
      total_frames: 0,
      summary: { total_frames: 0 }
    };
    b2Action.mockResolvedValue({ key, url: 'https://example.com/b2/get' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })));
    const loaded = await loadArtifactFromStorage(key, B2_ARTIFACT_BUCKET);
    expect(loaded.version).toBe('1.1');
    expect(loaded.job_id).toBe('job-1');
    expect(b2Action).toHaveBeenCalledWith({ action: 'artifact-playback-url', videoId, runId });
  });
});
