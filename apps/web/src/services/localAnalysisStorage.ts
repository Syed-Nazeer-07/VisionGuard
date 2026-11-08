/**
 * Local-first video library. Video blobs, analysis frames, and playback positions
 * live in separate IndexedDB stores so a one-second position update never rewrites
 * the video blob or the (potentially large) inference results.
 *
 * Nothing in this module talks to Supabase or any remote storage provider.
 */
export interface LocalTrack {
  id: number;
  className: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LocalFrame {
  time: number;
  tracks: LocalTrack[];
}

export interface LocalAnalysis {
  name: string;
  width: number;
  height: number;
  duration: number;
  model: string;
  frames: LocalFrame[];
  completedAt: number;
}

const DB_NAME = 'visionguard-local-first-v1';
const DB_VERSION = 1;
const KEY = 'active';
const scopedKey = (ownerId?: string) => ownerId ? 'user:' + ownerId : KEY;

export function openLocalDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of ['video', 'analysis', 'position']) {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local video storage unavailable'));
  });
}

async function read<T>(store: string, ownerId?: string): Promise<T | undefined> {
  const database = await openLocalDB();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = database.transaction(store, 'readonly').objectStore(store).get(scopedKey(ownerId));
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

async function write(store: string, value: unknown, ownerId?: string): Promise<void> {
  const database = await openLocalDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, scopedKey(ownerId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { database.close(); }
}

async function remove(store: string, ownerId?: string): Promise<void> {
  const database = await openLocalDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(store, 'readwrite');
      tx.objectStore(store).delete(scopedKey(ownerId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { database.close(); }
}

export interface SavedLocalVideo { file: Blob; name: string }
export interface SavedVideoHandle {
  kind: 'file-handle';
  name: string;
  handle: FileSystemFileHandle;
}

/** New videos are copied as Blobs in IndexedDB. Old file handles may lose
 * read permission on Edge/Chromium restart and cannot be silently regranted.
 */
export class ExpiredLocalVideoPermissionError extends Error {
  constructor() {
    super('Edge no longer permits access to the previously selected video. Choose the original video again. New opted-in saves retain a local copy rather than an expiring file shortcut.');
    this.name = 'ExpiredLocalVideoPermissionError';
  }
}

export function isHandleAccessDenied(error: unknown): boolean {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  return name === 'NotAllowedError' || name === 'SecurityError';
}
export async function resolveSavedVideoRecord(
  stored: SavedLocalVideo | SavedVideoHandle | undefined,
): Promise<SavedLocalVideo | undefined> {
  if (!stored) return undefined;
  if ('file' in stored) return stored;
  try {
    const file = await stored.handle.getFile();
    return { file, name: stored.name };
  } catch (error) {
    if (isHandleAccessDenied(error)) throw new ExpiredLocalVideoPermissionError();
    throw error;
  }
}
export async function readSavedVideo(ownerId?: string): Promise<SavedLocalVideo | undefined> {
  const stored = await read<SavedLocalVideo | SavedVideoHandle>('video', ownerId);
  if (!stored || 'file' in stored) return stored;

  // Older versions stored only a FileSystemFileHandle. When readable, replace
  // that fragile shortcut with actual bytes; when permission has expired,
  // discard the unusable shortcut so every new page visit does not fail again.
  let restored: SavedLocalVideo | undefined;
  try {
    restored = await resolveSavedVideoRecord(stored);
  } catch (error) {
    if (error instanceof ExpiredLocalVideoPermissionError) {
      await remove('video', ownerId).catch(() => {});
    }
    throw error;
  }
  if (restored) {
    // If the browser has insufficient quota, the current file can still be
    // opened. Only a successful write counts as durable offline retention.
    try {
      await write('video', restored, ownerId);
    } catch (error) {
      console.warn('Could not upgrade old saved file to an IndexedDB copy:', error);
    }
  }
  return restored;
}

export const localAnalysisStorage = {
  loadVideo: readSavedVideo,
  saveVideo: (file: Blob, name: string, ownerId?: string) => write('video', { file, name }, ownerId),
  loadAnalysis: (ownerId?: string) => read<LocalAnalysis>('analysis', ownerId),
  saveAnalysis: (analysis: LocalAnalysis, ownerId?: string) => write('analysis', analysis, ownerId),
  clearAnalysis: (ownerId?: string) => remove('analysis', ownerId),
  loadPosition: async (ownerId?: string): Promise<number> => (await read<number>('position', ownerId)) ?? 0,
  savePosition: (seconds: number, ownerId?: string) => write('position', seconds, ownerId),
  clearPosition: (ownerId?: string) => remove('position', ownerId),
  clearVideo: (ownerId?: string) => remove('video', ownerId),
};
