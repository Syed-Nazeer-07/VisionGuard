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

async function read<T>(store: string): Promise<T | undefined> {
  const database = await openLocalDB();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = database.transaction(store, 'readonly').objectStore(store).get(KEY);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

async function write(store: string, value: unknown): Promise<void> {
  const database = await openLocalDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { database.close(); }
}

async function remove(store: string): Promise<void> {
  const database = await openLocalDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(store, 'readwrite');
      tx.objectStore(store).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { database.close(); }
}

export interface SavedLocalVideo { file: Blob; name: string }

export const localAnalysisStorage = {
  loadVideo: () => read<SavedLocalVideo>('video'),
  saveVideo: (file: Blob, name: string) => write('video', { file, name }),
  loadAnalysis: () => read<LocalAnalysis>('analysis'),
  saveAnalysis: (analysis: LocalAnalysis) => write('analysis', analysis),
  clearAnalysis: () => remove('analysis'),
  loadPosition: async (): Promise<number> => (await read<number>('position')) ?? 0,
  savePosition: (seconds: number) => write('position', seconds),
  clearPosition: () => remove('position'),
  clearVideo: () => remove('video'),
};
