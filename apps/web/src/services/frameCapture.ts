/**
 * Cross-browser, bounded-size video frame capture for inference.
 * The source coordinate metadata stays in the original video dimensions;
 * the bitmap may be downscaled before crossing the worker boundary.
 */
export type BitmapFactory = (
  source: ImageBitmapSource, options?: ImageBitmapOptions
) => Promise<ImageBitmap>;

function resizeUnsupported(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof DOMException && error.name === 'NotSupportedError');
}

export async function captureInferenceBitmap(
  video: HTMLVideoElement,
  maxDimension = 640,
  factory: BitmapFactory = (source, options) =>
    options ? createImageBitmap(source, options) : createImageBitmap(source),
  newCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): Promise<ImageBitmap> {
  const { videoWidth: width, videoHeight: height } = video;
  if (!(width > 0 && height > 0 && maxDimension > 0 && Number.isFinite(maxDimension))) {
    throw new Error('Cannot capture an undecoded or invalid video frame.');
  }
  const ratio = Math.min(1, maxDimension / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * ratio));
  const targetHeight = Math.max(1, Math.round(height * ratio));

  try {
    const bitmap = await factory(video, {
      resizeWidth: targetWidth, resizeHeight: targetHeight, resizeQuality: 'medium',
    });
    // A few browsers silently ignore resizeWidth/resizeHeight. Do not transfer
    // a multi-megapixel frame to the worker if the requested size was ignored.
    if (bitmap.width === targetWidth && bitmap.height === targetHeight) return bitmap;
    bitmap.close();
  } catch (error) {
    // Do not retry security/tainting/decoding failures as a resize mismatch.
    if (!resizeUnsupported(error)) throw error;
  }

  // Some mobile implementations support ImageBitmap but not resize options.
  // Fallback to a bounded canvas: transferring a full 4K bitmap every frame
  // would otherwise waste CPU, RAM and worker transfer bandwidth.
  const canvas = newCanvas();
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to prepare a scaled video frame.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'medium';
  context.drawImage(video, 0, 0, targetWidth, targetHeight);
  return factory(canvas);
}
