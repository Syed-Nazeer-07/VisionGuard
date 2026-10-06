import { describe, it, expect } from 'vitest';
import { processOutput, iou, nonMaxSuppression } from './postprocess';
import type { BoundingBox } from '../types';
import { LABELS } from './labels';

describe('YOLO Postprocessing', () => {
  it('calculates IOU correctly', () => {
    const box1: BoundingBox = { x: 50, y: 50, w: 100, h: 100, prob: 0.9, classId: 2, className: 'car' };
    const box2: BoundingBox = { x: 50, y: 50, w: 100, h: 100, prob: 0.8, classId: 2, className: 'car' };
    expect(iou(box1, box2)).toBeCloseTo(1.0);

    const box3: BoundingBox = { x: 150, y: 50, w: 100, h: 100, prob: 0.8, classId: 2, className: 'car' };
    expect(iou(box1, box3)).toBeCloseTo(0.0);

    // Partial overlap (50x100 overlap)
    const box4: BoundingBox = { x: 100, y: 50, w: 100, h: 100, prob: 0.8, classId: 2, className: 'car' };
    // area1=10000, area2=10000, overlap = 50*100 = 5000. union = 20000 - 5000 = 15000. iou = 1/3
    expect(iou(box1, box4)).toBeCloseTo(1/3);
  });

  it('performs class-agnostic NMS correctly', () => {
    const boxes: BoundingBox[] = [
      { x: 50, y: 50, w: 100, h: 100, prob: 0.9, classId: 2, className: 'car' },
      { x: 55, y: 55, w: 90, h: 90, prob: 0.8, classId: 7, className: 'truck' }, // High overlap, different class
      { x: 200, y: 200, w: 50, h: 50, prob: 0.7, classId: 2, className: 'car' }, // No overlap
    ];

    const result = nonMaxSuppression(boxes, 0.45);
    expect(result).toHaveLength(2);
    expect(result[0].prob).toBe(0.9);
    expect(result[0].className).toBe('car');
    expect(result[1].prob).toBe(0.7);
  });

  it('decodes bbox, calculates confidence and maps classes correctly', () => {
    const numAnchors = 8400;
    const outputData = new Float32Array(84 * numAnchors);
    
    // Create a mock detection at anchor 10
    const anchorIdx = 10;
    outputData[0 * numAnchors + anchorIdx] = 100; // cx
    outputData[1 * numAnchors + anchorIdx] = 200; // cy
    outputData[2 * numAnchors + anchorIdx] = 50;  // w
    outputData[3 * numAnchors + anchorIdx] = 30;  // h
    
    // Set a high prob for classId 2 (car)
    outputData[(4 + 2) * numAnchors + anchorIdx] = 0.85;

    // Create another weak detection at anchor 20
    const anchorIdx2 = 20;
    outputData[0 * numAnchors + anchorIdx2] = 10;
    outputData[1 * numAnchors + anchorIdx2] = 20;
    outputData[2 * numAnchors + anchorIdx2] = 5;
    outputData[3 * numAnchors + anchorIdx2] = 3;
    outputData[(4 + 0) * numAnchors + anchorIdx2] = 0.1; // person (below threshold)

    const boxes = processOutput(outputData, 0.15, 0.45);
    
    expect(boxes).toHaveLength(1);
    expect(boxes[0].x).toBe(100);
    expect(boxes[0].y).toBe(200);
    expect(boxes[0].w).toBe(50);
    expect(boxes[0].h).toBe(30);
    expect(boxes[0].prob).toBeCloseTo(0.85);
    expect(boxes[0].classId).toBe(2);
    expect(boxes[0].className).toBe(LABELS[2]); // 'car'
  });
});
