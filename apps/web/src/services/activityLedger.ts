import { useEffect, useSyncExternalStore } from 'react';
import { supabase, supabaseConfig } from '../lib/supabase';

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
const cloudLoads = new Set<string>();
const cloudStatus = new Map<string, 'idle' | 'synced' | 'offline'>();
// Avoid re-uploading hundreds of unchanged session snapshots on every pause.
const uploadedRevisions = new Map<string, Map<string, number>>();


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
  // Cloud sync needs authenticated metadata access; local inference does not.
  // Do not emit a failed network write every few seconds in demo mode.
  if (supabaseConfig.isMock || !navigator.onLine || !records.length) {
    if (supabaseConfig.isMock || !navigator.onLine) cloudStatus.set(owner, 'offline');
    return;
  }
  // The caller only supplies an authenticated user ID. Supabase RLS separately
  // verifies the true auth.uid() on every row read/write.
  const revisions = uploadedRevisions.get(owner) ?? new Map<string, number>();
  const changed = records.filter(run =>
    run.updatedAt > (revisions.get(run.id) ?? 0));
  // No video bytes leave the device, and unchanged historical sessions do
  // not need to be serialized/reuploaded every 15 seconds.
  for (let i = 0; i < changed.length; i += 15) {
    const batch = changed.slice(i, i + 15);
    const rows = batch.map(run => ({
      owner_id: owner, run_id: run.id, payload: run,
      updated_at: new Date(run.updatedAt).toISOString()
    }));
    const { error } = await (supabase as any).from('user_analysis_records')
      .upsert(rows, { onConflict: 'owner_id,run_id' });
    if (error) throw error;
    for (const run of batch) revisions.set(run.id, run.updatedAt);
    uploadedRevisions.set(owner, revisions);
  }
  cloudStatus.set(owner, 'synced');
}
async function mergeFromCloud(owner: string): Promise<void> {
  if (cloudLoads.has(owner)) return;
  cloudLoads.add(owner);
  try {
    if (supabaseConfig.isMock || !navigator.onLine) {
      cloudStatus.set(owner, 'offline');
      return;
    }
    const { data, error } = await (supabase as any).from('user_analysis_records')
      .select('run_id,payload,updated_at').eq('owner_id', owner)
      .order('updated_at', { ascending: false }).limit(150);
    if (error) throw error;
    const current = getSnapshot(owner);
    const byId = new Map(current.records.map(r => [r.id, r]));
    let changed = false;
    for (const row of data || []) {
      const run = row.payload as AnalysisRecord;
      if (!run || typeof run.id !== 'string' || !run.vehicles ||
          !Array.isArray(run.violations) || !Number.isFinite(run.updatedAt)) continue;
      const revisions = uploadedRevisions.get(owner) ?? new Map<string, number>();
      revisions.set(run.id, run.updatedAt);
      uploadedRevisions.set(owner, revisions);
      const local = byId.get(run.id);
      if (!local || run.updatedAt > local.updatedAt) {
        byId.set(run.id, run);
        changed = true;
      }
    }
    if (changed) {
      const records = [...byId.values()].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,150);
      setState(owner, { loaded:true, records, error: current.error });
      // Merge remote back to local browser storage without re-uploading it.
      const prior = writeTasks.get(owner) ?? Promise.resolve();
      // Snapshot at execution time. A vehicle may have been observed while
      // the previous IndexedDB transaction was completing.
      const queued = prior.catch(()=>{}).then(()=>write(owner,getSnapshot(owner).records));
      writeTasks.set(owner,queued);
      await queued;
    }
    cloudStatus.set(owner,'synced');
  } catch (e) {
    // Local analysis works offline. Surface a warning without discarding data.
    cloudStatus.set(owner, 'offline');
    const state = getSnapshot(owner);
    setState(owner, { ...state, error: 'Cloud sync unavailable; activity remains saved locally. ' + String(e) });
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
      for (const updated of pending?.records ?? []) byId.set(updated.id, updated);
      setState(owner, { loaded: true, records: [...byId.values()].sort((a,b) => b.updatedAt-a.updatedAt), error: null });
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
        ...run, updatedAt: Date.now(), analyzedFrames: run.analyzedFrames + 1,
        maximumVisibleVehicles: Math.max(run.maximumVisibleVehicles, vehicles.length),
        vehicles: updated
      };
      });
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
  addReviewedViolation(ownerId: string, runId: string, event: ViolationRecord) {
    if (!ownerId || !event.evidenceNote.trim()) return;
    change(keyFor(ownerId), records => {
      if (!records.some(run => run.id === runId &&
          !run.violations.some(v => v.id === event.id))) return records;
      return records.map(run =>
        run.id !== runId || run.violations.some(v => v.id === event.id)
          ? run : { ...run, updatedAt: Date.now(), violations: [...run.violations, event] }
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
    window.addEventListener('online', restore);
    return () => window.removeEventListener('online', restore);
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
    distribution
  };
}
