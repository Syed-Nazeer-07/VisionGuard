import { describe, it, expect } from 'vitest';
import type { BoundingBox } from '../types';

// The logic from worker/index.ts for reversing letterbox padding
function reverseLetterbox(box: BoundingBox, padW: number, padH: number, ratio: number): BoundingBox {
  return {
    ...box,
    x: (box.x - padW) / ratio,
    y: (box.y - padH) / ratio,
    w: box.w / ratio,
    h: box.h / ratio,
  };
}

describe('Coordinate Transformation and Letterbox Reversal', () => {
  it('correctly maps model output coordinates back to original video pixels', () => {
    // Suppose original video is 1920x1080
    // Target model size is 640x640
    // ratio = min(640/1920, 640/1080) = min(0.333, 0.592) = 0.3333...
    // newUnpadW = 1920 * 0.3333 = 640
    // newUnpadH = 1080 * 0.3333 = 360
    // padW = (640 - 640) / 2 = 0
    // padH = (640 - 360) / 2 = 140
    
    const ratio = 640 / 1920;
    const padW = 0;
    const padH = 140;

    // A detection in the center of the model input (640x640)
    const modelBox: BoundingBox = {
      x: 320,
      y: 320,
      w: 100,
      h: 50,
      prob: 0.9,
      classId: 2,
      className: 'car'
    };

    const originalBox = reverseLetterbox(modelBox, padW, padH, ratio);

    // Expected:
    // x = (320 - 0) / (1/3) = 960 (center of 1920)
    // y = (320 - 140) / (1/3) = 180 * 3 = 540 (center of 1080)
    // w = 100 * 3 = 300
    // h = 50 * 3 = 150
    expect(originalBox.x).toBeCloseTo(960);
    expect(originalBox.y).toBeCloseTo(540);
    expect(originalBox.w).toBeCloseTo(300);
    expect(originalBox.h).toBeCloseTo(150);
  });
});
