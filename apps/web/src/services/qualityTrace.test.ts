import { describe, expect, it } from 'vitest';
import { appendQualityFrame, QA_MAX_FRAMES, serializeQualityTrace } from './qualityTrace';
import type { LiveTrack } from '../pipeline/tracker/liveProjection';

const track: LiveTrack = {
  id: 8, className: 'car', confidence: .93,
  x: 60, y: 40, w: 32, h: 20, vx: 5, vy: 0,
  motionPxPerSec: 5, isPredicted: true,
};
describe('local opt-in quality trace', () => {
  it('records the exact displayed ID and source-space box without video data', () => {
    const frames: Parameters<typeof appendQualityFrame>[0] = [];
    expect(appendQualityFrame(frames, 1, 640, 360, [track])).toBe(true);
    expect(frames).toHaveLength(1);
    expect(frames[0].groundTruth).toBeNull();
    expect(frames[0].exitedIds).toBeNull();
    expect(frames[0].predictions[0]).toMatchObject({
      id: 8, className: 'car', isPredicted: true,
      box: {x: 60, y:40, w:32, h:20},
    });
    const exported = serializeQualityTrace(frames);
    expect(exported).not.toContain('data:video');
    expect(JSON.parse(exported).annotationStatus).toContain('NOT ANNOTATED');
  });
  it('keeps monotonically increasing timestamps and throttles samples', () => {
    const frames: Parameters<typeof appendQualityFrame>[0] = [];
    expect(appendQualityFrame(frames, 1, 640, 360, [])).toBe(true);
    expect(appendQualityFrame(frames, 1.03, 640, 360, [])).toBe(false);
    expect(appendQualityFrame(frames, .9, 640, 360, [])).toBe(false);
    expect(appendQualityFrame(frames, 1.15, 640, 360, [])).toBe(true);
    expect(frames).toHaveLength(2);
  });
  it('has a hard memory limit and rejects invalid video dimensions', () => {
    const frames: Parameters<typeof appendQualityFrame>[0] = [];
    expect(appendQualityFrame(frames, 1, 0, 360, [track])).toBe(false);
    for (let i=0;i<QA_MAX_FRAMES;i++) {
      expect(appendQualityFrame(frames, i/5, 640, 360, [])).toBe(true);
    }
    expect(appendQualityFrame(frames, 600, 640, 360, [])).toBe(false);
    expect(frames).toHaveLength(QA_MAX_FRAMES);
  });
});
