import { describe, expect, it } from 'vitest';
import { decodeArtifact, findFrameAtMediaTime, type LegacyFrameResult } from './legacyAnalysisArtifacts';

const frame = (media_time: number): LegacyFrameResult => ({
  frame_id: Math.round(media_time * 30),
  media_time,
  source_width: 1920,
  source_height: 1080,
  boxes: [],
  tracks: [],
  detection_count: 0
});

describe('read-only legacy analysis artifact compatibility', () => {
  const frames = [frame(0), frame(0.0333), frame(0.0667)];

  it('returns exact and nearest frame using stored timestamps', () => {
    expect(findFrameAtMediaTime(frames, 0.0333)).toBe(frames[1]);
    expect(findFrameAtMediaTime(frames, 0.038)).toBe(frames[1]);
  });

  it('does not invent observations outside the allowed time window', () => {
    expect(findFrameAtMediaTime(frames, 5.0, 0.1)).toBeNull();
    expect(findFrameAtMediaTime(frames, -0.5, 0.1)).toBeNull();
    expect(findFrameAtMediaTime([], 1)).toBeNull();
  });

  it('rejects non-finite and negative tolerances and times', () => {
    expect(findFrameAtMediaTime(frames, NaN)).toBeNull();
    expect(findFrameAtMediaTime(frames, Infinity)).toBeNull();
    expect(findFrameAtMediaTime(frames, 0, -1)).toBeNull();
  });

  it('loads older plain JSON even when storage labels it application/octet-stream', async () => {
    const saved = {
      version: '1', job_id: 'old-session', total_frames: 1,
      frames: [frame(0)]
    };
    const blob = new Blob([JSON.stringify(saved)], { type: 'application/octet-stream' });
    const restored = await decodeArtifact(blob);
    expect(restored.job_id).toBe('old-session');
    expect(restored.frames[0].media_time).toBe(0);
  });

  it('rejects corrupt archive payloads rather than displaying made-up frames', async () => {
    await expect(decodeArtifact(new Blob(['{}'], { type: 'application/json' })))
      .rejects.toThrow('no frame data');
  });

  it('retains the original frame type required by older archive entries', () => {
    const saved: LegacyFrameResult = {
      ...frame(0.1),
      boxes: [{ x: 1, y: 2, w: 3, h: 4, prob: 0.9, class_id: 2, class_name: 'car' }],
      tracks: [{
        track_id: 9, x: 1, y: 2, w: 3, h: 4, prob: 0.9,
        class_id: 2, class_name: 'car',
        observation_type: 'interpolated', prediction_confidence: 0.6
      }],
      detection_count: 1
    };
    expect(saved.tracks[0].track_id).toBe(9);
    expect(saved.boxes[0].class_name).toBe('car');
  });
});
