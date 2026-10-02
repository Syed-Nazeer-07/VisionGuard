import type { PlateDetection } from './types';

export async function generatePlateCrop(bitmap: ImageBitmap, plate: PlateDetection): Promise<string> {
  // We expect plate coordinates to be normalized (0-1) because worker processes them as normalized.
  // Wait, the detector heuristic uses track coordinates. If track is normalized, plate is normalized.
  // Let's assume plate is normalized and we need to scale to bitmap dimensions.
  
  const width = bitmap.width;
  const height = bitmap.height;
  
  const px = Math.max(0, Math.floor(plate.x * width));
  const py = Math.max(0, Math.floor(plate.y * height));
  const pw = Math.min(width - px, Math.floor(plate.w * width));
  const ph = Math.min(height - py, Math.floor(plate.h * height));
  
  if (pw <= 0 || ph <= 0) {
    throw new Error('Invalid plate crop dimensions');
  }

  const canvas = new OffscreenCanvas(pw, ph);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2d context for crop');

  // Draw the specific region of the bitmap onto the new canvas
  ctx.drawImage(bitmap, px, py, pw, ph, 0, 0, pw, ph);

  // Convert to Blob and then to Base64
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
