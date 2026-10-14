import { describe, it, expect } from 'vitest';
import { findFrameAtMediaTime, type BackendFrameResult } from './backendAnalysis';

describe('findFrameAtMediaTime binary search', () => {
  const mockFrames: BackendFrameResult[] = [
    {
      frame_id: 1,
      media_time: 0.0,
      source_width: 1920,
      source_height: 1080,
      boxes: [],
      tracks: [{ track_id: 1, x: 100, y: 100, w: 50, h: 50, prob: 0.9, class_id: 2, class_name: 'car' }],
      detection_count: 1
    },
    {
      frame_id: 2,
      media_time: 0.0333,
      source_width: 1920,
      source_height: 1080,
      boxes: [],
      tracks: [{ track_id: 1, x: 105, y: 101, w: 50, h: 50, prob: 0.91, class_id: 2, class_name: 'car' }],
      detection_count: 1
    },
    {
      frame_id: 3,
      media_time: 0.0667,
      source_width: 1920,
      source_height: 1080,
      boxes: [],
      tracks: [{ track_id: 1, x: 110, y: 102, w: 50, h: 50, prob: 0.92, class_id: 2, class_name: 'car' }],
      detection_count: 1
    },
    {
      frame_id: 4,
      media_time: 0.1,
      source_width: 1920,
      source_height: 1080,
      boxes: [],
      tracks: [{ track_id: 1, x: 115, y: 103, w: 50, h: 50, prob: 0.93, class_id: 2, class_name: 'car' }],
      detection_count: 1
    }
  ];

  it('finds exact frame at media timestamp', () => {
    const frame = findFrameAtMediaTime(mockFrames, 0.0333);
    expect(frame).not.toBeNull();
    expect(frame?.frame_id).toBe(2);
  });

  it('finds closest frame within tolerance', () => {
    const frame = findFrameAtMediaTime(mockFrames, 0.038);
    expect(frame).not.toBeNull();
    expect(frame?.frame_id).toBe(2);
  });

  it('returns null if timestamp is beyond tolerance', () => {
    const frame = findFrameAtMediaTime(mockFrames, 5.0, 0.1);
    expect(frame).toBeNull();
  });

  it('handles empty frames array gracefully', () => {
    const frame = findFrameAtMediaTime([], 1.0);
    expect(frame).toBeNull();
  });

  it('preserves null speed for uncalibrated tracks', () => {
    const frame = findFrameAtMediaTime(mockFrames, 0.0);
    expect(frame).not.toBeNull();
    const track = frame?.tracks[0];
    expect(track?.speed).toBeUndefined();
  });

  it('selects earliest frame when seeked before first frame within tolerance', () => {
    const frame = findFrameAtMediaTime(mockFrames, -0.05, 0.1);
    expect(frame).not.toBeNull();
    expect(frame?.frame_id).toBe(1);
  });
});

describe('Detection Quality Profiles configuration', () => {
  it('defines Balanced profile with 0.20 confidence and 0.45 IoU', async () => {
    const { DETECTION_PROFILES } = await import('./backendAnalysis');
    expect(DETECTION_PROFILES.balanced).toBeDefined();
    expect(DETECTION_PROFILES.balanced.confidenceThreshold).toBe(0.20);
    expect(DETECTION_PROFILES.balanced.iouThreshold).toBe(0.45);
    expect(DETECTION_PROFILES.balanced.label).toBe('Balanced');
  });

  it('defines High Recall profile with 0.15 confidence and 0.45 IoU', async () => {
    const { DETECTION_PROFILES } = await import('./backendAnalysis');
    expect(DETECTION_PROFILES.high_recall).toBeDefined();
    expect(DETECTION_PROFILES.high_recall.confidenceThreshold).toBe(0.15);
    expect(DETECTION_PROFILES.high_recall.iouThreshold).toBe(0.45);
    expect(DETECTION_PROFILES.high_recall.label).toBe('High Recall');
  });

  it('sends detection_profile in createAnalysisJob request body', async () => {
    const { createAnalysisJob } = await import('./backendAnalysis');
    let capturedFormData: FormData | null = null;

    // Mock fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedFormData = init?.body as FormData;
      return {
        ok: true,
        json: async () => ({
          job_id: 'test-job-123',
          status: 'queued',
          detection_profile: 'high_recall',
          confidence_threshold: 0.15,
          iou_threshold: 0.45
        })
      } as Response;
    };

    try {
      const fakeFile = new File(['fake-video-bytes'], 'traffic.mp4', { type: 'video/mp4' });
      const res = await createAnalysisJob(fakeFile, false, undefined, 'high_recall');

      expect(res.job_id).toBe('test-job-123');
      expect(res.detection_profile).toBe('high_recall');
      expect(res.confidence_threshold).toBe(0.15);
      expect(capturedFormData).not.toBeNull();
      const fd = capturedFormData as unknown as FormData;
      expect(fd.get('detection_profile')).toBe('high_recall');
      expect(fd.get('save_to_history')).toBe('false');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Processing Speed configuration', () => {
  it('defines Full Detection with frame_stride 1', async () => {
    const { PROCESSING_SPEEDS } = await import('./backendAnalysis');
    expect(PROCESSING_SPEEDS.full).toBeDefined();
    expect(PROCESSING_SPEEDS.full.frameStride).toBe(1);
    expect(PROCESSING_SPEEDS.full.label).toBe('Full Detection');
  });

  it('defines Fast Processing with frame_stride 2', async () => {
    const { PROCESSING_SPEEDS } = await import('./backendAnalysis');
    expect(PROCESSING_SPEEDS.fast).toBeDefined();
    expect(PROCESSING_SPEEDS.fast.frameStride).toBe(2);
    expect(PROCESSING_SPEEDS.fast.label).toBe('Fast Processing');
  });

  it('sends processing_speed in createAnalysisJob request body', async () => {
    const { createAnalysisJob } = await import('./backendAnalysis');
    let capturedFormData: FormData | null = null;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedFormData = init?.body as FormData;
      return {
        ok: true,
        json: async () => ({
          job_id: 'test-job-fast',
          status: 'queued',
          detection_profile: 'balanced',
          confidence_threshold: 0.20,
          iou_threshold: 0.45,
          processing_speed: 'fast',
          frame_stride: 2
        })
      } as Response;
    };

    try {
      const fakeFile = new File(['fake-video-bytes'], 'traffic.mp4', { type: 'video/mp4' });
      const res = await createAnalysisJob(fakeFile, false, undefined, 'balanced', 'fast');

      expect(res.job_id).toBe('test-job-fast');
      expect(res.processing_speed).toBe('fast');
      expect(res.frame_stride).toBe(2);
      expect(capturedFormData).not.toBeNull();
      const fd = capturedFormData as unknown as FormData;
      expect(fd.get('processing_speed')).toBe('fast');
      expect(fd.get('detection_profile')).toBe('balanced');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Motion-Aware Tracking observation types', () => {
  it('correctly represents fresh detections, interpolated tracks, and predictions', () => {
    const frameResult: BackendFrameResult = {
      frame_id: 2,
      media_time: 0.0333,
      source_width: 1920,
      source_height: 1080,
      boxes: [],
      tracks: [
        {
          track_id: 1,
          x: 105,
          y: 101,
          w: 50,
          h: 50,
          prob: 0.88,
          class_id: 2,
          class_name: 'car',
          observation_type: 'interpolated',
          prediction_confidence: 0.90
        },
        {
          track_id: 2,
          x: 200,
          y: 150,
          w: 40,
          h: 30,
          prob: 0.75,
          class_id: 2,
          class_name: 'car',
          observation_type: 'predicted',
          prediction_confidence: 0.50
        }
      ],
      detection_count: 0
    };

    expect(frameResult.tracks[0].observation_type).toBe('interpolated');
    expect(frameResult.tracks[0].prediction_confidence).toBe(0.90);
    expect(frameResult.tracks[1].observation_type).toBe('predicted');
    expect(frameResult.tracks[1].prediction_confidence).toBe(0.50);
  });
});


