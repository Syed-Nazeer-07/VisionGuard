import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  getPublicUrl: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabaseConfig: { isMock: true, url: 'http://localhost:54321', anonKey: 'test' },
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: mocks.createSignedUrl,
        getPublicUrl: mocks.getPublicUrl,
      }),
    },
  },
}));

import { VideoUnavailableError, storageProviderFor } from './videoStorage';

describe('private Supabase video playback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns an authorized 1-hour signed URL, never a public URL', async () => {
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://storage.example/video?signed-token=temporary' },
      error: null,
    });
    const url = await storageProviderFor({ storage_provider: 'supabase' }).getVideoUrl({
      id: 'video-id', storage_path: 'video-id/original.mp4',
    });
    expect(url).toBe('https://storage.example/video?signed-token=temporary');
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('video-id/original.mp4', 3600);
    expect(mocks.getPublicUrl).not.toHaveBeenCalled();
  });

  it('refuses an unauthorized or missing file without constructing a public link', async () => {
    mocks.createSignedUrl.mockResolvedValue({
      data: null, error: { message: 'permission denied: sensitive internal path' }
    });
    await expect(storageProviderFor({ storage_provider: 'supabase' }).getVideoUrl({
      id: 'some-id', storage_path: 'some-id/original.mp4'
    })).rejects.toMatchObject({
      reason: 'object_missing',
      message: 'This video is unavailable or you are not authorized to access it.'
    });
    expect(mocks.getPublicUrl).not.toHaveBeenCalled();
  });

  it('reports absent video file paths before accessing storage', async () => {
    await expect(storageProviderFor({ storage_provider: 'supabase' }).getVideoUrl({
      id: 'some-id', storage_path: ''
    })).rejects.toBeInstanceOf(VideoUnavailableError);
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });
});
