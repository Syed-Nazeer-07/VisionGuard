import embeddedFont from '../assets/DejaVuSans-report.ttf?inline';
import { describe, expect, it } from 'vitest';
import type { AnalysisRecord } from './activityLedger';
import { createReportPdf } from './reportPdf';

const font = embeddedFont.split(',')[1];
const getFont = async () => font;

function session(index: number, observations: number): AnalysisRecord {
  return {
    id: 'video:' + index,
    sourceName: 'München, façade & "A40" – ' + 'long recording name '.repeat(9) + index + '.mp4',
    sourceType: 'uploaded-video', createdAt: Date.UTC(2026, 10, 10, index), updatedAt: Date.UTC(2026, 10, 11, index),
    analyzedFrames: 190, maximumVisibleVehicles: 10,
    vehicles: Object.fromEntries(Array.from({ length: observations }, (_, track) => [track + 1, {
      id: track + 1, type: 'car', observations: 3, firstSeenAt: 0, lastSeenAt: 1, confidence: .8, estimatedSpeedKmh: track ? 31.4 : null,
    }])),
    violations: [{ id: 'review:' + index, trackId: 1, type: 'observed_event', status: 'approved',
      observedAt: Date.UTC(2026, 10, 10, index, 2), evidenceNote: 'Note # ' + index + ' with accents, ä and é. '.repeat(16) }],
  };
}

describe('VisionGuard PDF pagination', () => {
  it('generates readable compact empty and single-session summaries', async () => {
    const empty = await createReportPdf([], 'executive', 'Empty period', new Date(0), getFont);
    const one = await createReportPdf([session(1, 3)], 'executive', 'One session', new Date(0), getFont);
    expect(empty.getNumberOfPages()).toBe(1);
    expect(one.getNumberOfPages()).toBe(1);
    expect(one.output().startsWith('%PDF-')).toBe(true);
  });

  it('puts comprehensive detail on additional pages without bloating the summary', async () => {
    const records = Array.from({ length: 18 }, (_, index) => session(index, 78));
    const detailed = await createReportPdf(records, 'detailed', 'All sessions', new Date(0), getFont);
    const summary = await createReportPdf(records, 'executive', 'All sessions', new Date(0), getFont);
    expect(summary.getNumberOfPages()).toBeLessThanOrEqual(4);
    expect(detailed.getNumberOfPages()).toBeGreaterThan(18);
    expect(detailed.output('arraybuffer').byteLength).toBeGreaterThan(summary.output('arraybuffer').byteLength);
  });
});
