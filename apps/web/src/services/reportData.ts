import { countRepeatedTracks, isRepeatedVehicleTrack, type AnalysisRecord } from './activityLedger';
import { csvCell } from './csvExport';
import { incidentLabel, incidentReviewLabel } from './incidentPresentation';

export type ReportScope = { session: string; start: string; end: string };

export function reportSessions(records: readonly AnalysisRecord[], scope: ReportScope) {
  const start = scope.start ? new Date(scope.start + 'T00:00:00').getTime() : -Infinity;
  const endDate = scope.end ? new Date(scope.end + 'T00:00:00') : null;
  if (endDate) endDate.setDate(endDate.getDate() + 1);
  const end = endDate?.getTime() ?? Infinity;
  return records.filter(run => (!scope.session || run.id === scope.session) && run.createdAt >= start && run.createdAt < end)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function analysisSource(run: AnalysisRecord) {
  if (run.id.startsWith('sample:')) return 'Sample footage';
  return run.sourceType === 'live-stream' ? 'Live source' : 'Recording';
}

export function breakdown(counts: Record<string, number>) {
  return Object.entries(counts)
    .map(([name, count]) => ({ name: name.replace(/(^|[-_\s])\w/g, part => part.toUpperCase()), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const number = (value: number | null | undefined, decimals: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(decimals) : '';

export function vehicleRows(run: AnalysisRecord) {
  return Object.values(run.vehicles).sort((a, b) => a.id - b.id).map(track => ({
    id: track.id,
    type: track.type,
    confidence: number(track.confidence * 100, 1),
    first: number(track.firstSeenAt, 2),
    last: number(track.lastSeenAt, 2),
    observations: track.observations,
    speed: number(track.estimatedSpeedKmh, 1),
    repeated: isRepeatedVehicleTrack(track) ? 'Yes' : 'No',
  }));
}

export function incidentRows(run: AnalysisRecord) {
  return [...run.violations].sort((a, b) => b.observedAt - a.observedAt).map(flag => ({
    id: flag.id,
    track: flag.trackId,
    reason: incidentLabel(flag.type),
    status: incidentReviewLabel(flag.status),
    origin: flag.id.startsWith('auto:') ? 'Automatic candidate' : 'Manual observation',
    observedAt: flag.observedAt,
    note: flag.evidenceNote,
  }));
}

export function sessionCounts(run: AnalysisRecord) {
  return [countRepeatedTracks(run), Object.keys(run.vehicles).length, run.violations.length] as const;
}

export function buildReportCsv(records: readonly AnalysisRecord[], kind: 'vehicle' | 'incident') {
  const columns = kind === 'vehicle'
    ? ['Session ID', 'Source', 'Source type', 'Session date (UTC)', 'Track ID', 'Vehicle class', 'Confidence (%)', 'First seen (s)', 'Last seen (s)', 'Observations', 'Estimated km/h (uncalibrated)', 'Repeated track']
    : ['Session ID', 'Source', 'Source type', 'Flag ID', 'Track ID', 'Origin', 'Review reason', 'Status', 'Observed at (UTC)', 'Evidence / note'];
  const rows = records.flatMap(run => {
    const session = [run.id, run.sourceName, analysisSource(run)];
    if (kind === 'vehicle') return vehicleRows(run).map(track => [
      ...session, new Date(run.createdAt).toISOString(), track.id, track.type, track.confidence, track.first, track.last,
      track.observations, track.speed, track.repeated,
    ]);
    return incidentRows(run).map(flag => [
      ...session, flag.id, flag.track ?? '', flag.origin, flag.reason, flag.status, new Date(flag.observedAt).toISOString(), flag.note,
    ]);
  });
  return '\uFEFF' + [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
