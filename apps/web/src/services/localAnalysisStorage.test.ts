import { describe, expect, it, vi } from 'vitest';
import { ExpiredLocalVideoPermissionError, isHandleAccessDenied, resolveSavedVideoRecord } from './localAnalysisStorage';

describe('Edge saved-video restoration', () => {
  it('restores a saved Blob without requesting another file permission', async () => {
    const local = { file: new Blob(['traffic']), name: 'traffic.mp4' };
    expect(await resolveSavedVideoRecord(local)).toBe(local);
  });
  it('keeps compatibility with older readable file handles', async () => {
    const file = new Blob(['legacy']);
    const getFile = vi.fn().mockResolvedValue(file);
    const result = await resolveSavedVideoRecord({
      kind: 'file-handle', name: 'legacy.mp4',
      handle: { getFile } as unknown as FileSystemFileHandle,
    });
    expect(result).toEqual({ file, name: 'legacy.mp4' });
    expect(getFile).toHaveBeenCalledTimes(1);
  });
  it('does not throw for a legacy Edge file permission rejection', async () => {
    const handle = { getFile: vi.fn().mockRejectedValue(
      Object.assign(new Error('not allowed'), { name: 'NotAllowedError' })
    ) };
    await expect(resolveSavedVideoRecord({
      kind: 'file-handle', name: 'lost.mp4',
      handle: handle as unknown as FileSystemFileHandle,
    })).rejects.toBeInstanceOf(ExpiredLocalVideoPermissionError);
    try {
      await resolveSavedVideoRecord({
        kind: 'file-handle', name: 'lost.mp4',
        handle: handle as unknown as FileSystemFileHandle,
      });
    } catch (error) {
      expect((error as Error).message).toContain('Choose the original video again');
      expect((error as Error).message).not.toContain('NotAllowedError');
    }
    expect(isHandleAccessDenied({ name: 'SecurityError' })).toBe(true);
  });
  it('does not hide unrelated corrupt-file errors', async () => {
    const fault = new Error('disk unavailable');
    await expect(resolveSavedVideoRecord({
      kind: 'file-handle', name: 'failed.mp4',
      handle: { getFile: vi.fn().mockRejectedValue(fault) } as unknown as FileSystemFileHandle,
    })).rejects.toBe(fault);
  });
});
