import type { AnalysisRecord, ViolationRecord } from './activityLedger';

export interface IncidentWithSession {
  run: AnalysisRecord;
  event: ViolationRecord;
}

/** Automatic detector flags remain visible without first opening a manual form. */
export function groupIncidentRecords(records: readonly AnalysisRecord[]) {
  const entries: IncidentWithSession[] = records.flatMap(run =>
    run.violations.map(event => ({ run, event })));
  entries.sort((a, b) => b.event.observedAt - a.event.observedAt);
  return {
    automatic: entries.filter(item => item.event.id.startsWith('auto:')),
    manual: entries.filter(item => !item.event.id.startsWith('auto:')),
  };
}
export function incidentLabel(type: string): string {
  if (type === 'speed_estimate_review') return 'High speed estimate';
  if (type === 'stationary_vehicle_review') return 'Stationary vehicle';
  if (type === 'observed_event') return 'Traffic observation';
  return type.replace(/[_-]/g, ' ').replace(/\b\w/g, s => s.toUpperCase());
}
/** Free-form reviewer notes are optional and can be one word or blank.
 * Every event still receives a non-empty, explicitly unverified description. */
export function manualIncidentEvidence(
  type: 'speed_estimate_review' | 'observed_event',
  note: string,
  estimatedSpeedKmh: number | null,
): string {
  const details = note.trim();
  if (type === 'speed_estimate_review') {
    const speed = estimatedSpeedKmh !== null && Number.isFinite(estimatedSpeedKmh)
      ? ' ≈' + Math.round(estimatedSpeedKmh) + ' km/h.'
      : '.';
    return 'Unverified speed estimate' + speed + (details ? ' ' + details : ' Review required.');
  }
  return details || 'Manually flagged traffic observation; review required.';
}
