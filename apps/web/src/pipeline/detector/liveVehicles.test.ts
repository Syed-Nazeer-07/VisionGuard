import { describe, expect, it } from 'vitest';
import { decodeTrafficVehicles } from './liveVehicles';

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

  it('preserves YOLO bus and truck scores without arbitrary colour-based correction', () => {
    const tensor = outputFor(5, .78);
    tensor[(4 + 7) * ANCHORS] = .67;
    const [box] = decodeTrafficVehicles(tensor, 1280, 720, .5, 0, 140);
    expect(box.className).toBe('bus');
    expect(box.classScores?.bus).toBeCloseTo(.78);
    expect(box.classScores?.truck).toBeCloseTo(.67);
  });

  it('can retain a motorcycle when an overlapping rider is slightly stronger', () => {
    const tensor = outputFor(3, .42);
    tensor[(4 + 0) * ANCHORS] = .78;
    const result = decodeTrafficVehicles(tensor, 1280, 720, .5, 0, 140);
    expect(result).toHaveLength(1);
    expect(result[0].className).toBe('motorcycle');
  });

});
