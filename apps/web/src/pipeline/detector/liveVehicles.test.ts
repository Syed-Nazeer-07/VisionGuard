import { describe, expect, it } from 'vitest';
import { correctClearFreightTrailer, decodeTrafficVehicles } from './liveVehicles';

const ANCHORS = 8400;
function outputFor(classId: number, score: number, anchor = 0) {
  const data = new Float32Array(84 * ANCHORS);
  data[anchor] = 320;
  data[ANCHORS + anchor] = 320;
  data[2 * ANCHORS + anchor] = 200;
  data[3 * ANCHORS + anchor] = 100;
  data[(4 + classId) * ANCHORS + anchor] = score;
  return data;
}

describe('live YOLO11 source-space vehicle decoding', () => {
  it('undoes letterbox padding and returns original video dimensions', () => {
    const boxes = decodeTrafficVehicles(outputFor(2, 0.95), 1280, 720, 0.5, 0, 140);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].className).toBe('car');
    expect(boxes[0].x).toBeCloseTo(640);
    expect(boxes[0].y).toBeCloseTo(360);
    expect(boxes[0].w).toBeCloseTo(400);
    expect(boxes[0].h).toBeCloseTo(200);
  });
  it('includes bus, truck, motorcycle, bicycle and train', () => {
    for (const id of [1, 3, 5, 6, 7]) {
      expect(decodeTrafficVehicles(outputFor(id, 0.9), 1280, 720, 0.5, 0, 140)).toHaveLength(1);
    }
  });
  it('rejects person-only detections and low-confidence artifact boxes', () => {
    expect(decodeTrafficVehicles(outputFor(0, 0.98), 1280, 720, 0.5, 0, 140)).toEqual([]);
    expect(decodeTrafficVehicles(outputFor(2, 0.28), 1280, 720, 0.5, 0, 140)).toEqual([]);
  });
  it('suppresses overlapping car and truck duplications', () => {
    const tensor = outputFor(2, 0.95);
    const next = outputFor(7, 0.90, 1);
    for (let c = 0; c < 84; c++) tensor[c * ANCHORS + 1] = next[c * ANCHORS + 1];
    expect(decodeTrafficVehicles(tensor, 1280, 720, 0.5, 0, 140)).toHaveLength(1);
  });
  it('finds a small lower-confidence motorcycle without weakening car detection', () => {
    const motorcycle = outputFor(3, .31);
    motorcycle[2 * ANCHORS] = 4;
    motorcycle[3 * ANCHORS] = 4;
    const boxes = decodeTrafficVehicles(motorcycle, 1280, 720, .5, 0, 140);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].className).toBe('motorcycle');
    const weakCar = outputFor(2, .31);
    expect(decodeTrafficVehicles(weakCar, 1280, 720, .5, 0, 140)).toEqual([]);
  });

  it('does not mislabel high-confidence pedestrians as motorcycles', () => {
    const tensor = outputFor(3, .34);
    tensor[(4 + 0) * ANCHORS] = .93;
    expect(decodeTrafficVehicles(tensor, 1280, 720, .5, 0, 140)).toEqual([]);
  });

  it('only reclassifies a long freight truck if a distinct coloured cab is visible', () => {
    const side = 640, area = side * side;
    const tensor = new Float32Array(3 * area).fill(.80);
    const visible = { x: 320, y: 320, w: 90, h: 240, prob: .88, classId: 5, className: 'bus' };
    // Lower quarter looks like a strongly blue tractor cab; upper cargo is neutral white.
    for (let y = 345; y < 430; y++) {
      for (let x = 280; x < 360; x++) {
        const i = y * side + x;
        tensor[i] = .18; tensor[area + i] = .38; tensor[2 * area + i] = .78;
      }
    }
    const result = correctClearFreightTrailer([visible], tensor, 1, 0, 0);
    expect(result[0].className).toBe('truck');
    expect(result[0].classId).toBe(7);
    expect(result[0].w).toBe(visible.w);
    expect(result[0].h).toBe(visible.h);

    // True bus with uniform appearance stays a bus; cars are never reclassified.
    const uniform = new Float32Array(3 * area).fill(.8);
    expect(correctClearFreightTrailer([visible], uniform, 1, 0, 0)[0].className).toBe('bus');
    expect(correctClearFreightTrailer([{ ...visible, classId: 2, className: 'car' }], tensor, 1, 0, 0)[0].className).toBe('car');
  });

});
