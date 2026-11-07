import { useSyncExternalStore } from 'react';

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
    } catch (error) {
      setState(owner, { loaded: true, records: states.get(owner)?.records ?? [], error: String(error) });
    }
  })();
  pendingLoads.set(owner, load);
  try { await load; } finally { pendingLoads.delete(owner); }
}

function persist(owner: string) {
  const existing = writeTimers.get(owner);
  if (existing) clearTimeout(existing);
  writeTimers.set(owner, setTimeout(() => {
    writeTimers.delete(owner);
    const records = getSnapshot(owner).records;
    const prior = writeTasks.get(owner) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(() => write(owner, records));
    writeTasks.set(owner, next);
    void next.catch(error => {
      const state = getSnapshot(owner);
      setState(owner, { ...state, error: 'Analysis history could not be saved: ' + String(error) });
    });
  }, 900));
}
function change(owner: string, transform: (records: AnalysisRecord[]) => AnalysisRecord[]) {
  const state = getSnapshot(owner);
  const records = transform(state.records);
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
    change(owner, records => records.map(run => {
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
    }));
  },
  async flush(ownerId: string) {
    const owner = keyFor(ownerId);
    const timer = writeTimers.get(owner);
    if (timer) { clearTimeout(timer); writeTimers.delete(owner); }
    const prior = writeTasks.get(owner) ?? Promise.resolve();
    const queued = prior.catch(() => {}).then(() => write(owner, getSnapshot(owner).records));
    writeTasks.set(owner, queued);
    await queued;
  },
  addReviewedViolation(ownerId: string, runId: string, event: ViolationRecord) {
    if (!ownerId || !event.evidenceNote.trim()) return;
    change(keyFor(ownerId), records => records.map(run =>
      run.id !== runId || run.violations.some(v => v.id === event.id)
        ? run : { ...run, updatedAt: Date.now(), violations: [...run.violations, event] }
    ));
  }
};

export function useActivityLedger(ownerId: string | null | undefined): ActivitySnapshot {
  const owner = keyFor(ownerId);
  if (ownerId && !states.get(owner)?.loaded) void ensureLoaded(owner);
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
