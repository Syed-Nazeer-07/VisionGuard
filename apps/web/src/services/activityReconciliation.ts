import type { AnalysisRecord, VehicleRecord, ViolationRecord } from './activityLedger';

/** Deterministic best-effort reconciliation of two *same-owner* revisions.
 *
 * Neither side is assumed to contain every observation after offline edits:
 * - preserve all distinct vehicles and incidents
 * - keep newest per-incident human review decisions (NOT legal verdicts)
 * - avoid adding frame counts and thereby manufacturing observations
 * - bump the document revision only if the cloud lacks combined information
 *
 * Independent concurrent edits with incorrect device clocks cannot be
 * perfectly ordered client-side. The server timestamp guards the document;
 * a future transactional RPC would be needed for strict shared editing.
 */
function validRevision(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function mergeVehicle(local: VehicleRecord, remote: VehicleRecord, newerLocal: boolean): VehicleRecord {
  const last = (local.lastSeenAt > remote.lastSeenAt ||
    (local.lastSeenAt === remote.lastSeenAt && newerLocal)) ? local : remote;
  const other = last === local ? remote : local;
  return {
    ...other, ...last,
    confidence: Math.max(local.confidence, remote.confidence),
    firstSeenAt: Math.min(local.firstSeenAt, remote.firstSeenAt),
    lastSeenAt: Math.max(local.lastSeenAt, remote.lastSeenAt),
    observations: Math.max(local.observations, remote.observations),
    estimatedSpeedKmh: last.estimatedSpeedKmh ?? other.estimatedSpeedKmh,
  };
}
function mergeEvent(local: ViolationRecord, remote: ViolationRecord, newerLocal: boolean): ViolationRecord {
  const localAt = validRevision(local.statusUpdatedAt);
  const remoteAt = validRevision(remote.statusUpdatedAt);
  const useLocal = localAt === remoteAt ? newerLocal : localAt > remoteAt;
  const winning = useLocal ? local : remote;
  // Evidence fields are source observations, not reviewer-editable text.
  // Prefer the original nonblank evidence if one side has an empty field.
  return {
    ...(useLocal ? remote : local), ...winning,
    evidenceNote: winning.evidenceNote?.trim() ? winning.evidenceNote :
      (useLocal ? remote : local).evidenceNote,
  };
}
function sameVehicle(a: VehicleRecord, b: VehicleRecord): boolean {
  return a.id === b.id && a.type === b.type && a.confidence === b.confidence &&
    a.firstSeenAt === b.firstSeenAt && a.lastSeenAt === b.lastSeenAt &&
    a.observations === b.observations &&
    a.estimatedSpeedKmh === b.estimatedSpeedKmh;
}
function sameEvent(a: ViolationRecord, b: ViolationRecord): boolean {
  return a.id === b.id && a.type === b.type && a.trackId === b.trackId &&
    a.observedAt === b.observedAt && a.status === b.status &&
    a.evidenceNote === b.evidenceNote &&
    validRevision(a.statusUpdatedAt) === validRevision(b.statusUpdatedAt);
}
function equivalentContent(a: AnalysisRecord, b: AnalysisRecord): boolean {
  if (a.id !== b.id || a.sourceName !== b.sourceName ||
      a.sourceType !== b.sourceType || a.createdAt !== b.createdAt ||
      a.analyzedFrames !== b.analyzedFrames ||
      a.maximumVisibleVehicles !== b.maximumVisibleVehicles) return false;
  const aVehicleKeys = Object.keys(a.vehicles);
  const bVehicleKeys = Object.keys(b.vehicles);
  if (aVehicleKeys.length !== bVehicleKeys.length ||
      aVehicleKeys.some(id => !b.vehicles[id] ||
        !sameVehicle(a.vehicles[id], b.vehicles[id]))) return false;
  if (a.violations.length !== b.violations.length) return false;
  const byId = new Map(b.violations.map(event => [event.id, event]));
  return a.violations.every(event => {
    const other = byId.get(event.id);
    return !!other && sameEvent(event, other);
  });
}

export type ReconciledRun = {
  record: AnalysisRecord;
  /** True only if the remote copy actually lacks local observations/reviews. */
  needsUpload: boolean;
};

export function reconcileAnalysisRun(
  local: AnalysisRecord,
  remote: AnalysisRecord,
  remoteRevisionAt = remote.updatedAt,
): ReconciledRun {
  if (local.id !== remote.id) throw Error('Cannot reconcile two different analysis sessions.');
  const newerLocal = local.updatedAt > remote.updatedAt;
  const winner = newerLocal ? local : remote;
  const older = newerLocal ? remote : local;
  const vehicles: Record<string, VehicleRecord> = { ...older.vehicles, ...winner.vehicles };
  for (const id of Object.keys(local.vehicles)) {
    const remoteVehicle = remote.vehicles[id];
    if (remoteVehicle) vehicles[id] = mergeVehicle(local.vehicles[id], remoteVehicle, newerLocal);
  }
  const remoteEvents = new Map(remote.violations.map(event => [event.id, event]));
  const localEvents = new Map(local.violations.map(event => [event.id, event]));
  const ids = [...new Set([...remoteEvents.keys(), ...localEvents.keys()])];
  const violations = ids.map(id => {
    const l = localEvents.get(id), r = remoteEvents.get(id);
    return l && r ? mergeEvent(l, r, newerLocal) : (l ?? r)!;
  });
  const combined: AnalysisRecord = {
    ...winner, createdAt: Math.min(local.createdAt, remote.createdAt),
    analyzedFrames: Math.max(local.analyzedFrames, remote.analyzedFrames),
    maximumVisibleVehicles: Math.max(local.maximumVisibleVehicles, remote.maximumVisibleVehicles),
    vehicles, violations,
  };
  if (equivalentContent(combined, remote)) {
    // If the server already has all information, adopt its source revision.
    return { record: remote, needsUpload: false };
  }
  const serverRevision = validRevision(remoteRevisionAt);
  // Existing local newer revisions can be sent as-is, unless a server-side
  // trigger rejected them. Always exceed the actual remote document revision.
  return {
    record: {
      ...combined,
      updatedAt: Math.max(local.updatedAt, remote.updatedAt, serverRevision) + 1,
    },
    needsUpload: true,
  };
}

/** Validate a returned PostgREST row before treating a write as acknowledged.
 * The revision used by the SQL stale-update trigger is the *column* timestamp,
 * not the client-provided timestamp embedded in the JSON payload.
 */
export function readCloudAnalysisRow(value: unknown): {
  runId: string; revisionAt: number; record: AnalysisRecord;
} {
  const row = value as {
    run_id?: unknown; updated_at?: unknown; payload?: Partial<AnalysisRecord>;
  } | null;
  if (!row || typeof row.run_id !== 'string' ||
      typeof row.updated_at !== 'string' ||
      !row.payload || typeof row.payload !== 'object' ||
      row.payload.id !== row.run_id ||
      !Number.isFinite(row.payload.updatedAt) ||
      !row.payload.vehicles || typeof row.payload.vehicles !== 'object' ||
      !Array.isArray(row.payload.violations)) {
    throw Error('Cloud returned an invalid analysis row; no revision was acknowledged.');
  }
  const revisionAt = Date.parse(row.updated_at);
  if (!Number.isFinite(revisionAt) || revisionAt < 0) {
    throw Error('Cloud returned an invalid analysis revision timestamp.');
  }
  return { runId: row.run_id, revisionAt,
    record: row.payload as AnalysisRecord };
}

/** Compare the revision and every history field relevant to the UI.
 * Avoid unnecessary refresh writes and preserve cloud conflict detection.
 */
export function sameAnalysisRecord(a: AnalysisRecord, b: AnalysisRecord): boolean {
  return a.updatedAt === b.updatedAt && equivalentContent(a, b);
}

/** Pure simulation of a PostgREST upsert result. Useful in CI without
 * privileged database keys or mutating a real user's session.
 */
export function planCloudAcknowledgements(
  sent: readonly AnalysisRecord[],
  received: unknown,
  latest: readonly AnalysisRecord[],
): Array<{
  runId: string;
  acceptedRevisionAt: number;
  current: AnalysisRecord;
  resolved: ReconciledRun;
  /** Did the database actually accept the snapshot that was sent? */
  acceptedSent: boolean;
  /** Later in-flight local frames are handled by the next scheduled sync. */
  pendingLocalUpdates: boolean;
}> {
  if (!Array.isArray(received) || received.length !== sent.length) {
    throw Error('Cloud did not acknowledge every requested analysis record.');
  }
  const submittedIds = new Set(sent.map(run => run.id));
  if (submittedIds.size !== sent.length) {
    throw Error('Cloud sync attempted duplicate session IDs.');
  }
  const byId = new Map<string, ReturnType<typeof readCloudAnalysisRow>>();
  for (const row of received) {
    const accepted = readCloudAnalysisRow(row);
    if (!submittedIds.has(accepted.runId) || byId.has(accepted.runId)) {
      throw Error('Cloud returned an unexpected or duplicate session record.');
    }
    byId.set(accepted.runId, accepted);
  }
  const currentById = new Map(latest.map(run => [run.id, run]));
  return sent.map(sentRun => {
    const server = byId.get(sentRun.id);
    if (!server) throw Error('Cloud omitted an analysis revision.');
    const current = currentById.get(sentRun.id) ?? sentRun;
    // An accepted write can finish AFTER more video frames arrived locally.
    // Those newer frames are queued for the next scheduled sync, not a
    // conflict requiring immediate retries while inference is still running.
    // Only a returned row which differs from the SENT snapshot indicates
    // a genuine server conflict (e.g. a stale-update trigger returned OLD).
    const acceptedSent = equivalentContent(sentRun, server.record);
    return {
      runId: sentRun.id,
      acceptedRevisionAt: server.revisionAt,
      current,
      resolved: acceptedSent ?
        { record: current, needsUpload: false } :
        reconcileAnalysisRun(current, server.record, server.revisionAt),
      acceptedSent,
      pendingLocalUpdates: acceptedSent && !sameAnalysisRecord(current, server.record),
    };
  });
}
