import { describe, expect, it, vi } from 'vitest';
import { captureInferenceBitmap, type BitmapFactory } from './frameCapture';

const video = (width = 3840, height = 2160) =>
  ({ videoWidth: width, videoHeight: height }) as HTMLVideoElement;
const bitmap = {} as ImageBitmap;

describe('bounded inference frame capture', () => {
  it('prefers native resize with correct aspect ratio', async () => {
    const factory = vi.fn(async () => bitmap);
    expect(await captureInferenceBitmap(video(), 640, factory)).toBe(bitmap);
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith(expect.anything(), {
      resizeWidth: 640, resizeHeight: 360, resizeQuality: 'medium'
    });
  });

  it('does not upscale small camera frames', async () => {
    const factory = vi.fn(async () => bitmap);
    await captureInferenceBitmap(video(320, 180), 640, factory);
    expect(factory).toHaveBeenCalledWith(expect.anything(), {
      resizeWidth: 320, resizeHeight: 180, resizeQuality: 'medium'
    });
  });

  it('uses a bounded canvas when resize options are unsupported', async () => {
    const drawImage = vi.fn();
    const context = { drawImage } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0, height: 0, getContext: vi.fn(() => context)
    } as unknown as HTMLCanvasElement;
    const factory = vi.fn(async (_source: ImageBitmapSource, opts?: ImageBitmapOptions) => {
      if (opts) throw new TypeError('Unsupported resizeWidth');
      return bitmap;
    });
    expect(await captureInferenceBitmap(video(), 640, factory, () => canvas)).toBe(bitmap);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 640, 360);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory.mock.calls[1][0]).toBe(canvas);
  });

  it('does not mask security errors with a canvas fallback', async () => {
    const factory: BitmapFactory = async () => {
      throw new DOMException('Tainted source', 'SecurityError');
    };
    const canvas = vi.fn(() => { throw Error('Must not use a canvas'); });
    await expect(captureInferenceBitmap(video(), 640, factory, canvas)).rejects.toThrow('Tainted source');
    expect(canvas).not.toHaveBeenCalled();
  });

  it('rejects frames without decoded dimensions', async () => {
    const factory = vi.fn(async () => bitmap);
    await expect(captureInferenceBitmap(video(0, 0), 640, factory)).rejects.toThrow('undecoded');
    expect(factory).not.toHaveBeenCalled();
  });
});
