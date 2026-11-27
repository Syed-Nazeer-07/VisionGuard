import { describe, expect, it } from 'vitest';
import { type AnalysisRecord, summarizeActivity } from './activityLedger';
import { buildReportCsv, reportSessions, sessionCounts, vehicleRows } from './reportData';

const first: AnalysisRecord = {
  id: 'video:first', sourceName: '=SUM(A1) - München, "Ring".mp4', sourceType: 'uploaded-video',
  createdAt: new Date(2026, 10, 10, 23, 59).getTime(), updatedAt: new Date(2026, 10, 14).getTime(),
  analyzedFrames: 9, maximumVisibleVehicles: 2,
  vehicles: {
    1: { id: 1, type: 'car', observations: 2, firstSeenAt: 0, lastSeenAt: 1, confidence: .85, estimatedSpeedKmh: null },
    2: { id: 2, type: 'truck', observations: 1, firstSeenAt: 0, lastSeenAt: 0, confidence: .78, estimatedSpeedKmh: 34.3 },
  },
  violations: [{ id: 'auto:1', trackId: 1, type: 'stationary_vehicle_review', status: 'approved', observedAt: 0, evidenceNote: '  @malicious()' }],
};
const later = { ...first, id: 'video:later', createdAt: new Date(2026, 10, 11).getTime(), violations: [] };

describe('report scope and populations', () => {
  it('uses inclusive browser calendar days and intersects them with a session', () => {
    const records = [first, later];
    expect(reportSessions(records, { session: '', start: '2026-11-10', end: '2026-11-10' })).toEqual([first]);
    expect(reportSessions(records, { session: later.id, start: '2026-11-10', end: '2026-11-10' })).toEqual([]);
    expect(reportSessions(records, { session: '', start: '', end: '' })).toEqual([later, first]);
  });

  it('retains brief rows, null speed and repeated IDs across independent sessions', () => {
    expect(sessionCounts(first)).toEqual([1, 2, 1]);
    expect(summarizeActivity([first, later]).vehicles).toBe(2);
    expect(vehicleRows(first).map(track => [track.repeated, track.speed])).toEqual([['Yes', ''], ['No', '34.3']]);
    const csv = buildReportCsv([first, later], 'vehicle');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(5);
    expect(csv).toContain(`"'=SUM(A1) - München, ""Ring"".mp4"`);
    expect(csv).toContain('"video:first"');
    expect(csv).toContain('"video:later"');
  });

  it('exports human decisions and protects free text in spreadsheets', () => {
    const csv = buildReportCsv([first], 'incident');
    expect(csv).toContain('"Reviewed"');
    expect(csv).toContain('"Automatic candidate"');
    expect(csv).toContain(`"'  @malicious()"`);
    expect(buildReportCsv([], 'incident').trim().split('\r\n')).toHaveLength(1);
  });
});
