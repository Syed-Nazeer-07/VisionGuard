import { useEffect, useSyncExternalStore } from 'react';
import { supabase, supabaseConfig } from '../lib/supabase';
import { planCloudAcknowledgements, readCloudAnalysisRow, reconcileAnalysisRun, sameAnalysisRecord } from './activityReconciliation';

export type VehicleClass = 'car' | 'bus' | 'truck' | 'motorcycle' | 'bicycle' | 'train' | 'bus/truck';

export interface VehicleRecord {
  id: number;
  type: VehicleClass | string;
  confidence: number;
  firstSeenAt: number;
  lastSeenAt: number;
  observations: number;
  estimatedSpeedKmh: number | null;
}
export interface ViolationRecord {
  id: string;
  trackId: number | null;
  type: string;
  observedAt: number;
  status: 'pending_review' | 'approved' | 'rejected';
  evidenceNote: string;
  /** When a reviewer last changed the decision; absent in historical flags. */
  statusUpdatedAt?: number;
}
export interface AnalysisRecord {
  id: string;
  sourceName: string;
  sourceType: 'uploaded-video' | 'live-stream';
  createdAt: number;
  updatedAt: number;
  analyzedFrames: number;
  maximumVisibleVehicles: number;
  vehicles: Record<string, VehicleRecord>;
  violations: ViolationRecord[];
}
export interface ActivitySnapshot {
  loaded: boolean;
  records: AnalysisRecord[];
  error: string | null;
}
const EMPTY: ActivitySnapshot = { loaded: false, records: [], error: null };
const DB = 'visionguard-activity-v1';
const EVENT = 'visionguard:activity-changed';
const states = new Map<string, ActivitySnapshot>();
const pendingLoads = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const writeTasks = new Map<string, Promise<void>>();
const cloudTasks = new Map<string, Promise<void>>();
const lastCloudPush = new Map<string, number>();
const lastCloudPull = new Map<string, number>();
const CLOUD_FOCUS_REFRESH_MS = 30_000;

/** Refresh a signed-in user's analysis metadata when they return to an
 * already-open app. This doesn't grant tab capture or access video bytes.
 * The throttle prevents one cloud query for every window-focus event.
 */
export function shouldRefreshCloudOnFocus(
  lastAt: number | undefined,
  now: number,
  visible: boolean,
  online: boolean,
): boolean {
  return visible && online && Number.isFinite(now) &&
    (lastAt === undefined || !Number.isFinite(lastAt) ||
      now < lastAt || now - lastAt >= CLOUD_FOCUS_REFRESH_MS);
}
const cloudLoads = new Set<string>();
const cloudStatus = new Map<string, 'idle' | 'synced' | 'offline'>();
// Avoid re-uploading hundreds of unchanged session snapshots on every pause.
const uploadedRevisions = new Map<string, Map<string, number>>();


/** Record revisions must change even when multiple optical observations or
 * review actions occur in the same millisecond. */
export function nextActivityRevision(previous: number, now = Date.now()): number {
  return Math.max(Number.isFinite(now) ? now : Date.now(), previous + 1);
}

const keyFor = (owner: string | null | undefined) => owner || 'signed-out';
const getSnapshot = (owner: string) => states.get(owner) ?? EMPTY;
function emit() {
  listeners.forEach(listener => listener());
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}
function setState(owner: string, next: ActivitySnapshot) {
  states.set(owner, next);
  emit();
}

/** Clear only the stale cloud warning after cloud access recovers.
 * Do not hide a local IndexedDB storage error. */
export function clearResolvedCloudWarning(error: string | null): string | null {
  return error?.startsWith('Cloud sync unavailable;') ||
    error?.startsWith('Cloud backup unavailable;') ? null : error;
}
function markCloudSynced(owner: string) {
  cloudStatus.set(owner, 'synced');
  const current = getSnapshot(owner);
  const error = clearResolvedCloudWarning(current.error);
  if (error !== current.error) setState(owner, { ...current, error });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('accounts')) request.result.createObjectStore('accounts');
    };
    request.onerror = () => reject(request.error ?? Error('Analysis activity storage unavailable'));
    request.onsuccess = () => resolve(request.result);
  });
}
async function read(owner: string): Promise<AnalysisRecord[]> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('accounts', 'readonly');
      const request = tx.objectStore('accounts').get(owner);
      request.onsuccess = () => resolve((request.result as AnalysisRecord[] | undefined) ?? []);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function write(owner: string, records: AnalysisRecord[]): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('accounts', 'readwrite');
      tx.objectStore('accounts').put(records, owner);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? Error('Local activity save failed'));
      tx.onabort = () => reject(tx.error ?? Error('Local activity save aborted'));
    });
  } finally { db.close(); }
}

async function syncToCloud(owner: string, records: AnalysisRecord[]): Promise<void> {
  if (supabaseConfig.isMock || !navigator.onLine || !records.length) {
    if (supabaseConfig.isMock || !navigator.onLine) cloudStatus.set(owner, 'offline');
    return;
  }
  const revisions = uploadedRevisions.get(owner) ?? new Map<string, number>();
  const changed = records.filter(run => run.updatedAt > (revisions.get(run.id) ?? 0));
  for (let i = 0; i < changed.length; i += 15) {
    // Concurrent browser devices can update different fields of the same
    // document. A trigger may return OLD for stale writes without an error.
    // Inspect the actual server response, reconcile the two versions, and
    // retry a bounded number of times. Never report success for a rejected
    // revision, and never fetch/re-upload original video bytes.
    let pending = changed.slice(i, i + 15);
    for (let attempt = 0; pending.length && attempt < 3; attempt++) {
      const rows = pending.map(run => ({
        owner_id: owner, run_id: run.id, payload: run,
        updated_at: new Date(run.updatedAt).toISOString()
      }));
      const { data, error } = await (supabase as any).from('user_analysis_records')
        .upsert(rows, { onConflict: 'owner_id,run_id' })
        .select('run_id,payload,updated_at');
      if (error) throw error;
      const acknowledgements = planCloudAcknowledgements(
        pending, data, getSnapshot(owner).records
      );
      const retry: AnalysisRecord[] = [];
      for (const ack of acknowledgements) {
        // The column timestamp is what the SQL trigger actually compares.
        // Never record a sent revision if the database returned its OLD row.
        revisions.set(ack.runId, ack.acceptedRevisionAt);
        uploadedRevisions.set(owner, revisions);
        if (ack.resolved.needsUpload) {
          change(owner, runs => runs.map(run =>
            run.id === ack.runId ? ack.resolved.record : run));
          retry.push(ack.resolved.record);
        } else if (!sameAnalysisRecord(ack.current, ack.resolved.record)) {
          // A different browser already has the complete latest snapshot.
          change(owner, runs => runs.map(run =>
            run.id === ack.runId ? ack.resolved.record : run));
        }
      }
      pending = retry;
    }
    if (pending.length) {
      throw Error('Cloud changed during sync; merged activity remains local. Retry when online.');
    }
  }
  const remaining = getSnapshot(owner).records.some(run =>
    run.updatedAt > (revisions.get(run.id) ?? 0));
  if (!remaining) markCloudSynced(owner);
}

async function mergeFromCloud(owner: string): Promise<void> {
  if (cloudLoads.has(owner)) return;
  cloudLoads.add(owner);
  try {
    if (supabaseConfig.isMock || !navigator.onLine) {
      cloudStatus.set(owner, 'offline');
      return;
    }
    lastCloudPull.set(owner, Date.now());
    const { data, error } = await (supabase as any).from('user_analysis_records')
      .select('run_id,payload,updated_at').eq('owner_id', owner)
      .order('updated_at', { ascending: false }).limit(150);
    if (error) throw error;
    const current = getSnapshot(owner);
    const byId = new Map(current.records.map(r => [r.id, r]));
    const revisions = uploadedRevisions.get(owner) ?? new Map<string, number>();
    let changed = false;
    let needsPush = false;
    for (const row of data || []) {
      const { runId, record: cloudRun, revisionAt } = readCloudAnalysisRow(row);
      revisions.set(runId, revisionAt);
      const local = byId.get(runId);
      const reconciled = local ?
        reconcileAnalysisRun(local, cloudRun, revisionAt) :
        { record: cloudRun, needsUpload: false };
      needsPush ||= reconciled.needsUpload;
      if (!local || !sameAnalysisRecord(local, reconciled.record)) {
        byId.set(runId, reconciled.record);
        changed = true;
      }
    }
    uploadedRevisions.set(owner, revisions);
    if (changed) {
      const records = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 150);
      setState(owner, { loaded: true, records, error: current.error });
      const prior = writeTasks.get(owner) ?? Promise.resolve();
      const queued = prior.catch(() => {}).then(() => write(owner, getSnapshot(owner).records));
      writeTasks.set(owner, queued);
      await queued;
    }
    if (needsPush) {
      // A local decision/observation survived reconciliation. Re-upload it
      // after the remote revision has been recorded, without recursion.
      persist(owner);
    } else {
      markCloudSynced(owner);
    }
  } catch (e) {
    cloudStatus.set(owner, 'offline');
    const state = getSnapshot(owner);
    setState(owner, { ...state,
      error: 'Cloud sync unavailable; activity remains saved locally. ' + String(e) });
  } finally { cloudLoads.delete(owner); }
}

async function ensureLoaded(owner: string): Promise<void> {
  if (states.get(owner)?.loaded) return;
  const inProgress = pendingLoads.get(owner);
  if (inProgress) return inProgress;
  const load = (async () => {
    try {
      const records = await read(owner);
      const pending = states.get(owner);
      // A newly created session may already have arrived while IDB was reading.
      // Always merge instead of overwriting live observations.
      const byId = new Map(records.map(r => [r.id, r]));
      let mergedUnsavedHistory = false;
      for (const updated of pending?.records ?? []) {
        const stored = byId.get(updated.id);
        if (!stored) { byId.set(updated.id, updated); mergedUnsavedHistory = true; continue; }
        // Reading an older IndexedDB snapshot must not erase newly created
        // incidents or observations from this page while it was loading.
        const resolution = reconcileAnalysisRun(updated, stored);
        byId.set(updated.id, resolution.record);
        mergedUnsavedHistory ||= resolution.needsUpload;
      }
      setState(owner, { loaded: true,
        records: [...byId.values()].sort((a,b) => b.updatedAt-a.updatedAt), error: null });
      if (mergedUnsavedHistory) persist(owner);
      // Do not delay UI hydration on a network call.
      void mergeFromCloud(owner);
    } catch (error) {
      setState(owner, { loaded: true, records: states.get(owner)?.records ?? [], error: String(error) });
    }
  })();
  pendingLoads.set(owner, load);
  try { await load; } finally { pendingLoads.delete(owner); }
}

function persist(owner: string) {
  // Debounce-by-reset could indefinitely defer persistence when inference
  // keeps running. Schedule a write at least once each interval instead.
  if (writeTimers.has(owner)) return;
  writeTimers.set(owner, setTimeout(() => {
    writeTimers.delete(owner);
    const records = getSnapshot(owner).records;
    const prior = writeTasks.get(owner) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(() => write(owner, records));
    writeTasks.set(owner, next);
    void next.then(() => {
      // Keep live playback and tracking responsive: do NOT make a network
      // round-trip after each sampled video frame. Local writes stay fast;
      // remote sync runs at most every 15s, plus explicit pause/visibility flush.
      if (Date.now() - (lastCloudPush.get(owner) ?? 0) < 15_000) return;
      lastCloudPush.set(owner, Date.now());
      const priorCloud = cloudTasks.get(owner) ?? Promise.resolve();
      const cloud = priorCloud.catch(()=>{}).then(() => syncToCloud(owner, getSnapshot(owner).records));
      cloudTasks.set(owner, cloud);
      return cloud.catch(error => { lastCloudPush.set(owner, 0); throw error; });
    }).catch(error => {
      const state = getSnapshot(owner);
      setState(owner, { ...state, error: 'Local or cloud activity save warning: ' + String(error) });
    });
  }, 1500));
}
function change(owner: string, transform: (records: AnalysisRecord[]) => AnalysisRecord[]) {
  const state = getSnapshot(owner);
  const records = transform(state.records);
  // If the session was closed/removed, do not rewrite the same snapshot
  // and trigger network traffic for an inference result with no target run.
  if (records === state.records) return;
  setState(owner, { loaded: state.loaded, records, error: state.error });
  persist(owner);
}

export function mergeEstimatedSpeeds(
  vehicles: Record<string, VehicleRecord>,
  tracks: ReadonlyArray<{id:number; speedKmh: number | null; isPredicted?:boolean}>
): Record<string, VehicleRecord> {
  let updated: Record<string, VehicleRecord> | null = null;
  for (const track of tracks) {
    // Only real optical evidence can update the estimate. Do not create new
    // vehicle IDs or manufacture speeds from predicted-only bounding boxes.
    const speed = track.speedKmh;
    if (track.isPredicted || !Number.isFinite(track.id) || speed === null ||
        !Number.isFinite(speed) || speed < 0 || speed > 160) continue;
    const id = String(track.id);
    const old = (updated ?? vehicles)[id];
    if (!old || (old.estimatedSpeedKmh !== null &&
        Math.abs(old.estimatedSpeedKmh - speed) < 1)) continue;
    if (!updated) updated = {...vehicles};
    updated[id] = {...old,estimatedSpeedKmh:speed};
  }
  return updated ?? vehicles;
}

/** Change a review decision without mutating a session or silently dropping
 * detector evidence. A monotonic revision ensures two rapid updates remain
 * distinguishable for IndexedDB/cloud revision checks.
 * "approved" means a human reviewed a flag, NOT a legally proven offence.
 */
export function changeIncidentReviewStatus(
  records: AnalysisRecord[],
  runId: string,
  eventId: string,
  status: ViolationRecord['status'],
  now = Date.now(),
): AnalysisRecord[] {
  if (!runId || !eventId || !['pending_review', 'approved', 'rejected'].includes(status))
    return records;
  let changed = false;
  const next = records.map(run => {
    if (run.id !== runId || !run.violations.some(event => event.id === eventId &&
        event.status !== status)) return run;
    changed = true;
    const revision = Math.max(Number.isFinite(now) ? now : Date.now(), run.updatedAt + 1);
    return {
      ...run,
      updatedAt: revision,
      violations: run.violations.map(event =>
        event.id === eventId ? { ...event, status, statusUpdatedAt: revision } : event),
    };
  });
  return changed ? next : records;
}

/** Scoped to a real authenticated account. Never shares records across sign-ins. */
export const activityLedger = {
  load(ownerId: string) { return ensureLoaded(keyFor(ownerId)); },
  snapshot(ownerId: string) { return getSnapshot(keyFor(ownerId)); },
  subscribe(callback: () => void) {
    listeners.add(callback);
    return () => { listeners.delete(callback); };
  },
  begin(ownerId: string, id: string, sourceName: string, sourceType: AnalysisRecord['sourceType']) {
    if (!ownerId) return;
    const owner = keyFor(ownerId);
    void ensureLoaded(owner);
    change(owner, records => {
      if (records.some(r => r.id === id)) return records;
      const now = Date.now();
      return [{
        id, sourceName, sourceType, createdAt: now, updatedAt: now,
        analyzedFrames: 0, maximumVisibleVehicles: 0, vehicles: {}, violations: []
      }, ...records].slice(0, 150);
    });
  },
  observe(
    ownerId: string, runId: string, mediaTime: number,
    vehicles: ReadonlyArray<{ id: number; className: string; confidence: number; speedKmh?: number | null }>
  ) {
    if (!ownerId || !runId) return;
    const owner = keyFor(ownerId);
    change(owner, records => {
      if (!records.some(run => run.id === runId)) return records;
      return records.map(run => {
      if (run.id !== runId) return run;
      const updated = { ...run.vehicles };
      for (const track of vehicles) {
        if (!Number.isFinite(track.id) || !Number.isFinite(track.confidence) || !track.className) continue;
        const id = String(track.id);
        const previous = updated[id];
        updated[id] = {
          id: track.id, type: track.className,
          confidence: Math.max(previous?.confidence ?? 0, track.confidence),
          firstSeenAt: previous?.firstSeenAt ?? mediaTime,
          lastSeenAt: mediaTime,
          observations: (previous?.observations ?? 0) + 1,
          estimatedSpeedKmh: track.speedKmh ?? previous?.estimatedSpeedKmh ?? null
        };
      }
      return {
        ...run, updatedAt: nextActivityRevision(run.updatedAt),
        analyzedFrames: run.analyzedFrames + 1,
        maximumVisibleVehicles: Math.max(run.maximumVisibleVehicles, vehicles.length),
        vehicles: updated
      };
      });
    });
  },
  updateSpeedEstimates(
    ownerId: string, runId: string,
    tracks: ReadonlyArray<{id:number;speedKmh:number|null;isPredicted?:boolean}>
  ) {
    if (!ownerId || !runId || !tracks.length) return;
    change(keyFor(ownerId), records => {
      let changed = false;
      const next = records.map(run => {
        if (run.id !== runId) return run;
        const vehicles = mergeEstimatedSpeeds(run.vehicles, tracks);
        if (vehicles === run.vehicles) return run;
        changed = true;
        return {...run, updatedAt:nextActivityRevision(run.updatedAt), vehicles};
      });
      return changed ? next : records;
    });
  },
  async flush(ownerId: string) {
    const owner = keyFor(ownerId);
    const timer = writeTimers.get(owner);
    if (timer) { clearTimeout(timer); writeTimers.delete(owner); }
    const prior = writeTasks.get(owner) ?? Promise.resolve();
    const queued = prior.catch(() => {}).then(() => write(owner, getSnapshot(owner).records));
    writeTasks.set(owner, queued);
    await queued;
    const priorCloud = cloudTasks.get(owner) ?? Promise.resolve();
    const cloud = priorCloud.catch(()=>{}).then(()=>syncToCloud(owner, getSnapshot(owner).records));
    cloudTasks.set(owner,cloud);
    try { await cloud; } catch (error) {
      const state = getSnapshot(owner);
      setState(owner, { ...state, error: 'Cloud backup unavailable; saved locally. ' + String(error) });
    }
  },
  cloudState(ownerId: string) { return cloudStatus.get(keyFor(ownerId)) ?? 'idle'; },
  setIncidentReviewStatus(
    ownerId: string, runId: string, eventId: string, status: ViolationRecord['status']
  ): boolean {
    if (!ownerId) return false;
    let updated = false;
    change(keyFor(ownerId), records => {
      const next = changeIncidentReviewStatus(records, runId, eventId, status);
      updated = next !== records;
      return next;
    });
    return updated;
  },
  addReviewedViolation(ownerId: string, runId: string, event: ViolationRecord) {
    if (!ownerId || !event.evidenceNote.trim()) return;
    change(keyFor(ownerId), records => {
      if (!records.some(run => run.id === runId &&
          !run.violations.some(v => v.id === event.id))) return records;
      return records.map(run =>
        run.id !== runId || run.violations.some(v => v.id === event.id)
          ? run : { ...run, updatedAt: nextActivityRevision(run.updatedAt),
            violations: [...run.violations, event] }
      );
    });
  }
};

export function useActivityLedger(ownerId: string | null | undefined): ActivitySnapshot {
  const owner = keyFor(ownerId);
  if (ownerId && !states.get(owner)?.loaded) void ensureLoaded(owner);

  useEffect(() => {
    if (!ownerId) return;
    // Offline observations remain in IndexedDB. Reconcile cloud history and
    // retry pending metadata when the connection returns, without reloading.
    const restore = () => {
      void ensureLoaded(ownerId).then(() => mergeFromCloud(ownerId))
        .then(() => activityLedger.flush(ownerId))
        .catch(error => console.warn('Activity reconnect failed:', error));
    };
    const refreshOnReturn = () => {
      if (!shouldRefreshCloudOnFocus(
        lastCloudPull.get(ownerId), Date.now(), !document.hidden, navigator.onLine
      )) return;
      lastCloudPull.set(ownerId, Date.now());
      void ensureLoaded(ownerId)
        .then(() => mergeFromCloud(ownerId))
        .catch(error => console.warn('Activity cloud refresh failed:', error));
    };
    window.addEventListener('online', restore);
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      window.removeEventListener('online', restore);
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [ownerId]);

  return useSyncExternalStore(
    activityLedger.subscribe,
    () => ownerId ? getSnapshot(owner) : EMPTY,
    () => EMPTY
  );
}

export function summarizeActivity(records: readonly AnalysisRecord[]) {
  const vehicles = records.flatMap(run => Object.values(run.vehicles));
  const distribution: Record<string, number> = {};
  for (const v of vehicles) distribution[v.type] = (distribution[v.type] ?? 0) + 1;
  return {
    runs: records.length,
    vehicles: vehicles.length,
    analyzedFrames: records.reduce((sum,r) => sum + r.analyzedFrames, 0),
    maximumVisible: records.reduce((max,r) => Math.max(max, r.maximumVisibleVehicles), 0),
    violations: records.reduce((sum,r) => sum + r.violations.length, 0),
    pendingReviews: records.reduce((sum,r) =>
      sum + r.violations.filter(event => event.status === 'pending_review').length, 0),
    reviewedFlags: records.reduce((sum,r) =>
      sum + r.violations.filter(event => event.status === 'approved').length, 0),
    dismissedFlags: records.reduce((sum,r) =>
      sum + r.violations.filter(event => event.status === 'rejected').length, 0),
    distribution
  };
}
