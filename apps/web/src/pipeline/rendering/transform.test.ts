import { describe, it, expect } from 'vitest';
import {
  computeVideoTransform,
  sourceCenterBoxToDisplay,
  sourceTopLeftBoxToDisplay,
  sourcePointToDisplay,
  centerBoxToCorners,
  cornersToCenterBox
} from './transform';

describe('computeVideoTransform', () => {
  it('computes contain mode with pillarboxing (wider container)', () => {
    // 1920x1080 (16:9) video inside 2560x1080 container
    const transform = computeVideoTransform(
      { videoWidth: 1920, videoHeight: 1080 },
      { containerWidth: 2560, containerHeight: 1080 },
      'contain'
    );
    expect(transform.scale).toBe(1);
    expect(transform.renderWidth).toBe(1920);
    expect(transform.renderHeight).toBe(1080);
    expect(transform.offsetX).toBe((2560 - 1920) / 2); // 320
    expect(transform.offsetY).toBe(0);
    expect(transform.visibleRect).toEqual({ x: 320, y: 0, width: 1920, height: 1080 });
  });

  it('computes contain mode with letterboxing (taller container)', () => {
    // 1920x1080 (16:9) video inside 1920x1200 (16:10) container
    const transform = computeVideoTransform(
      { videoWidth: 1920, videoHeight: 1080 },
      { containerWidth: 1920, containerHeight: 1200 },
      'contain'
    );
    expect(transform.scale).toBe(1);
    expect(transform.renderWidth).toBe(1920);
    expect(transform.renderHeight).toBe(1080);
    expect(transform.offsetX).toBe(0);
    expect(transform.offsetY).toBe((1200 - 1080) / 2); // 60
    expect(transform.visibleRect).toEqual({ x: 0, y: 60, width: 1920, height: 1080 });
  });

  it('computes cover mode with horizontal crop (taller container in fullscreen)', () => {
    // 1920x1080 video inside 1920x1200 (16:10) fullscreen screen
    const transform = computeVideoTransform(
      { videoWidth: 1920, videoHeight: 1080 },
      { containerWidth: 1920, containerHeight: 1200 },
      'cover'
    );
    // Height must reach 1200: scale = 1200 / 1080 = 1.1111...
    expect(transform.scale).toBeCloseTo(1200 / 1080, 5);
    expect(transform.renderHeight).toBe(1200);
    expect(transform.renderWidth).toBeCloseTo(1920 * (1200 / 1080), 3);
    // Negative offset to crop left/right evenly
    expect(transform.offsetX).toBeLessThan(0);
    expect(transform.offsetY).toBe(0);
  });

  it('computes cover mode with vertical crop (ultra-wide container)', () => {
    // 1920x1080 video inside 2560x1080 container
    const transform = computeVideoTransform(
      { videoWidth: 1920, videoHeight: 1080 },
      { containerWidth: 2560, containerHeight: 1080 },
      'cover'
    );
    expect(transform.scale).toBeCloseTo(2560 / 1920, 5);
    expect(transform.renderWidth).toBe(2560);
    expect(transform.renderHeight).toBeCloseTo(1080 * (2560 / 1920), 3);
    expect(transform.offsetX).toBe(0);
    expect(transform.offsetY).toBeLessThan(0);
  });

  it('accurately converts center bounding box to display coordinates', () => {
    const transform = computeVideoTransform(
      { videoWidth: 1000, videoHeight: 500 },
      { containerWidth: 1000, containerHeight: 500 },
      'contain'
    );
    // Center at (500, 250), size (200, 100)
    const displayBox = sourceCenterBoxToDisplay({ x: 500, y: 250, w: 200, h: 100 }, transform);
    expect(displayBox.x).toBe(400); // 500 - 200/2
    expect(displayBox.y).toBe(200); // 250 - 100/2
    expect(displayBox.w).toBe(200);
    expect(displayBox.h).toBe(100);
  });

  it('accurately converts top-left bounding box to display coordinates', () => {
    const transform = computeVideoTransform(
      { videoWidth: 1000, videoHeight: 500 },
      { containerWidth: 1000, containerHeight: 500 },
      'contain'
    );
    // Top-left at (400, 200), size (200, 100)
    const displayBox = sourceTopLeftBoxToDisplay({ x: 400, y: 200, w: 200, h: 100 }, transform);
    expect(displayBox.x).toBe(400);
    expect(displayBox.y).toBe(200);
    expect(displayBox.w).toBe(200);
    expect(displayBox.h).toBe(100);
  });

  it('transforms 2D point with scaling and offsets', () => {
    const transform = computeVideoTransform(
      { videoWidth: 1000, videoHeight: 500 },
      { containerWidth: 1200, containerHeight: 500 },
      'contain'
    );
    // offsetX = (1200 - 1000) / 2 = 100
    const pt = sourcePointToDisplay({ x: 500, y: 250 }, transform);
    expect(pt.x).toBe(600); // 500 + 100
    expect(pt.y).toBe(250);
  });

  it('converts between center box and corner coordinates accurately and bidirectionally', () => {
    const centerBox = { x: 300, y: 200, w: 100, h: 60 };
    const corners = centerBoxToCorners(centerBox);
    expect(corners.x1).toBe(250);
    expect(corners.y1).toBe(170);
    expect(corners.x2).toBe(350);
    expect(corners.y2).toBe(230);

    const backToCenter = cornersToCenterBox(corners);
    expect(backToCenter.x).toBe(centerBox.x);
    expect(backToCenter.y).toBe(centerBox.y);
    expect(backToCenter.w).toBe(centerBox.w);
    expect(backToCenter.h).toBe(centerBox.h);
  });

  it('ensures Video Review (top-left) and Live Analysis (center) produce identical display coordinates', () => {
    const transform = computeVideoTransform(
      { videoWidth: 1920, videoHeight: 1080 },
      { containerWidth: 1280, containerHeight: 720 },
      'contain'
    );

    // Vehicle detection in Live Analysis has center (cx: 600, cy: 400), w: 120, h: 80
    const liveCenterBox = { x: 600, y: 400, w: 120, h: 80 };
    const liveDisplay = sourceCenterBoxToDisplay(liveCenterBox, transform);

    // Persisted trajectory in Video Review has top-left [cx - w/2, cy - h/2, w, h] = [540, 360, 120, 80]
    const reviewTopLeftBox = { x: 540, y: 360, w: 120, h: 80 };
    const reviewDisplay = sourceTopLeftBoxToDisplay(reviewTopLeftBox, transform);

    expect(liveDisplay.x).toBeCloseTo(reviewDisplay.x, 5);
    expect(liveDisplay.y).toBeCloseTo(reviewDisplay.y, 5);
    expect(liveDisplay.w).toBeCloseTo(reviewDisplay.w, 5);
    expect(liveDisplay.h).toBeCloseTo(reviewDisplay.h, 5);
  });
});
