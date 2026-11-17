import { describe, expect, it } from 'vitest';
import { decodeTrafficVehicles, matchesYoloTensor, trafficLetterbox, YOLO_OUTPUT_SHAPE } from './liveVehicles';

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
    const boxes = decodeTrafficVehicles(outputFor(2, 0.95), trafficLetterbox(1280, 720));
    expect(boxes).toHaveLength(1);
    expect(boxes[0].className).toBe('car');
    expect(boxes[0].x).toBeCloseTo(640);
    expect(boxes[0].y).toBeCloseTo(360);
    expect(boxes[0].w).toBeCloseTo(400);
    expect(boxes[0].h).toBeCloseTo(200);
  });
  it('includes bus, truck, motorcycle, bicycle and train', () => {
    for (const id of [1, 3, 5, 6, 7]) {
      expect(decodeTrafficVehicles(outputFor(id, 0.9), trafficLetterbox(1280, 720))).toHaveLength(1);
    }
  });
  it('rejects person-only detections and low-confidence artifact boxes', () => {
    expect(decodeTrafficVehicles(outputFor(0, 0.98), trafficLetterbox(1280, 720))).toEqual([]);
    expect(decodeTrafficVehicles(outputFor(2, 0.28), trafficLetterbox(1280, 720))).toEqual([]);
  });
  it('suppresses overlapping car and truck duplications', () => {
    const tensor = outputFor(2, 0.95);
    const next = outputFor(7, 0.90, 1);
    for (let c = 0; c < 84; c++) tensor[c * ANCHORS + 1] = next[c * ANCHORS + 1];
    expect(decodeTrafficVehicles(tensor, trafficLetterbox(1280, 720))).toHaveLength(1);
  });
  it('finds a small lower-confidence motorcycle without weakening car detection', () => {
    const motorcycle = outputFor(3, .31);
    motorcycle[2 * ANCHORS] = 4;
    motorcycle[3 * ANCHORS] = 4;
    const boxes = decodeTrafficVehicles(motorcycle, trafficLetterbox(1280, 720));
    expect(boxes).toHaveLength(1);
    expect(boxes[0].className).toBe('motorcycle');
    const weakCar = outputFor(2, .31);
    expect(decodeTrafficVehicles(weakCar, trafficLetterbox(1280, 720))).toEqual([]);
  });

  it('retains a real motorcycle after hundreds of duplicate high-score car anchors', () => {
    const tensor = new Float32Array(84 * ANCHORS);
    for (let anchor = 0; anchor < 350; anchor++) {
      tensor[anchor] = 240;
      tensor[ANCHORS + anchor] = 320;
      tensor[2 * ANCHORS + anchor] = 155;
      tensor[3 * ANCHORS + anchor] = 75;
      tensor[(4 + 2) * ANCHORS + anchor] = 0.91 - anchor * 0.0002;
    }
    const bikeIndex = 400;
    tensor[bikeIndex] = 480;
    tensor[ANCHORS + bikeIndex] = 320;
    tensor[2 * ANCHORS + bikeIndex] = 25;
    tensor[3 * ANCHORS + bikeIndex] = 36;
    tensor[(4 + 3) * ANCHORS + bikeIndex] = 0.39;
    const boxes = decodeTrafficVehicles(tensor, trafficLetterbox(640, 640));
    expect(boxes.filter(box => box.className === 'car')).toHaveLength(1);
    expect(boxes.filter(box => box.className === 'motorcycle')).toHaveLength(1);
  });

  it('does not mislabel high-confidence pedestrians as motorcycles', () => {
    const tensor = outputFor(3, .34);
    tensor[(4 + 0) * ANCHORS] = .93;
    expect(decodeTrafficVehicles(tensor, trafficLetterbox(1280, 720))).toEqual([]);
  });

  it('preserves YOLO bus and truck scores without arbitrary colour-based correction', () => {
    const tensor = outputFor(5, .78);
    tensor[(4 + 7) * ANCHORS] = .67;
    const [box] = decodeTrafficVehicles(tensor, trafficLetterbox(1280, 720));
    expect(box.className).toBe('bus');
    expect(box.classScores?.bus).toBeCloseTo(.78);
    expect(box.classScores?.truck).toBeCloseTo(.67);
  });

  it('can retain a motorcycle when an overlapping rider is slightly stronger', () => {
    const tensor = outputFor(3, .42);
    tensor[(4 + 0) * ANCHORS] = .78;
    const result = decodeTrafficVehicles(tensor, trafficLetterbox(1280, 720));
    expect(result).toHaveLength(1);
    expect(result[0].className).toBe('motorcycle');
  });

});

describe('active browser model contract', () => {
  it('rejects a transposed or quantized tensor even if the element count matches', () => {
    expect(matchesYoloTensor({ isTensor: true, type: 'float32', shape: [1, 8400, 84] }, YOLO_OUTPUT_SHAPE)).toBe(false);
    expect(matchesYoloTensor({ isTensor: true, type: 'uint8', shape: [1, 84, 8400] }, YOLO_OUTPUT_SHAPE)).toBe(false);
    expect(matchesYoloTensor({ isTensor: true, type: 'float32', shape: [1, 84, 8400] }, YOLO_OUTPUT_SHAPE)).toBe(true);
  });

  it('inverts independently rounded dimensions on an odd-sized portrait source', () => {
    const transform = trafficLetterbox(713, 1277);
    const data = outputFor(2, 0.95);
    data[0] = transform.left + 257 * transform.scaleX;
    data[8400] = transform.top + 873 * transform.scaleY;
    data[16800] = 127 * transform.scaleX;
    data[25200] = 207 * transform.scaleY;
    const [box] = decodeTrafficVehicles(data, transform);
    expect(box.x).toBeCloseTo(257, 4);
    expect(box.y).toBeCloseTo(873, 4);
    expect(box.w).toBeCloseTo(127, 4);
    expect(box.h).toBeCloseTo(207, 4);
  });
});

it('suppresses strongly overlapping bicycle and motorcycle candidates without suppressing a nearby separate bike', () => {
  const data = outputFor(3, .83);
  const addBike = (anchor: number, x: number) => {
    data[anchor] = x;
    data[ANCHORS + anchor] = 320;
    data[2 * ANCHORS + anchor] = 200;
    data[3 * ANCHORS + anchor] = 100;
    data[5 * ANCHORS + anchor] = .79;
  };
  addBike(1, 323);
  addBike(2, 444);
  expect(decodeTrafficVehicles(data, trafficLetterbox(640, 640)).map(box => box.className))
    .toEqual(['motorcycle', 'bicycle']);
});
