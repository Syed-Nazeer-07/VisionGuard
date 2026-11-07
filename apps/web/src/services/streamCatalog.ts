import { supabase } from '../lib/supabase';

export interface StreamSource {
  id: string;
  name: string;
  url: string;
  format: 'hls' | 'video';
  createdAt: number;
}

const key = (owner: string) => 'visionguard:sources:' + owner;
const activeKey = (owner: string) => 'visionguard:active-stream:' + owner;
const pendingAddsKey = (owner: string) => 'visionguard:source-pending-add:' + owner;
const pendingDeletesKey = (owner: string) => 'visionguard:source-pending-remove:' + owner;
function idsFor(key: string): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(stored) ? stored.filter(v=>typeof v==='string') : [];
  } catch { return []; }
}
function flag(key: string, id: string, enabled: boolean) {
  const next = new Set(idsFor(key));
  if (enabled) next.add(id); else next.delete(id);
  localStorage.setItem(key, JSON.stringify([...next]));
}
function toRow(owner: string, source: StreamSource) {
  return {
    owner_id: owner, source_id: source.id, name: source.name,
    source_url: source.url, format: source.format,
    created_at: new Date(source.createdAt).toISOString()
  };
}

function cleanUrl(raw: string): string {
  const value = raw.trim();
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Browser analysis requires an HTTP(S) video or HLS URL. RTSP needs a secure HLS conversion server.');
  }
  if (url.username || url.password) throw new Error('Do not embed credentials in a stream URL.');
  if (value.length > 2048) throw new Error('Stream URL is too long.');
  return url.toString();
}
export function validateStream(raw: string): { url: string; format: StreamSource['format'] } {
  const url = cleanUrl(raw);
  return { url, format: /\.m3u8(?:\?|$)/i.test(url) ? 'hls' : 'video' };
}

export const streamCatalog = {
  list(owner: string): StreamSource[] {
    if (!owner) return [];
    try {
      const stored = JSON.parse(localStorage.getItem(key(owner)) || '[]');
      if (!Array.isArray(stored)) return [];
      return stored.filter(s => typeof s.id === 'string' && typeof s.name === 'string'
        && typeof s.url === 'string' && (s.format === 'video' || s.format === 'hls'));
    } catch { return []; }
  },
  add(owner: string, name: string, rawUrl: string): StreamSource {
    if (!owner) throw Error('Sign in to save stream sources.');
    const cleanName = name.trim().slice(0,80);
    if (!cleanName) throw Error('Give this video stream a name.');
    const normalized = validateStream(rawUrl);
    const streams = this.list(owner);
    const existing = streams.find(s => s.url === normalized.url);
    if (existing) return existing;
    const source: StreamSource = {
      id: crypto.randomUUID(), name: cleanName, url: normalized.url,
      format: normalized.format, createdAt: Date.now()
    };
    localStorage.setItem(key(owner), JSON.stringify([source, ...streams].slice(0,40)));
    flag(pendingAddsKey(owner), source.id, true);
    return source;
  },
  remove(owner: string, id: string): void {
    if (!owner) return;
    localStorage.setItem(key(owner), JSON.stringify(this.list(owner).filter(s=>s.id!==id)));
    flag(pendingAddsKey(owner), id, false);
    flag(pendingDeletesKey(owner), id, true);
    if (this.active(owner) === id) localStorage.removeItem(activeKey(owner));
  },
  /** Save only small stream metadata. Live media bytes are never sent here. */
  async saveRemote(owner: string, source: StreamSource): Promise<void> {
    if (!owner) return;
    const { error } = await (supabase as any).from('user_stream_sources')
      .upsert(toRow(owner, source), { onConflict: 'owner_id,source_id' });
    if (error) throw new Error('Stream source cloud save failed: ' + error.message);
    flag(pendingAddsKey(owner), source.id, false);
  },
  async removeRemote(owner: string, id: string): Promise<void> {
    if (!owner) return;
    const { error } = await (supabase as any).from('user_stream_sources')
      .delete().eq('owner_id', owner).eq('source_id', id);
    if (error) throw new Error('Stream source cloud removal failed: ' + error.message);
    flag(pendingDeletesKey(owner), id, false);
  },
  /** Restore stream selections on another device; local edits remain offline-safe. */
  async refresh(owner: string): Promise<StreamSource[]> {
    if (!owner) return [];
    const { data, error } = await (supabase as any).from('user_stream_sources')
      .select('source_id,name,source_url,format,created_at').eq('owner_id',owner)
      .order('created_at',{ascending:false}).limit(40);
    if (error) throw new Error('Stream source sync failed: ' + error.message);
    const pendingAdds = new Set(idsFor(pendingAddsKey(owner)));
    const pendingDeletes = new Set(idsFor(pendingDeletesKey(owner)));
    const localPending = this.list(owner).filter(s=>pendingAdds.has(s.id));
    const remote = (data || []).filter((row: any) => !pendingDeletes.has(row.source_id))
      .map((row: any) => ({
        id: row.source_id as string, name: row.name as string,
        url: row.source_url as string, format: row.format as 'hls'|'video',
        createdAt: Date.parse(row.created_at) || Date.now()
      }));
    const merged = new Map<string, StreamSource>();
    for (const source of [...remote,...localPending]) merged.set(source.id,source);
    const sources = [...merged.values()].sort((a,b)=>b.createdAt-a.createdAt).slice(0,40);
    localStorage.setItem(key(owner),JSON.stringify(sources));
    // Retry prior offline additions and removals after reconnecting.
    const errors: string[] = [];
    for (const source of localPending) {
      try { await this.saveRemote(owner,source); } catch (e) { errors.push(String(e)); }
    }
    for (const id of pendingDeletes) {
      try { await this.removeRemote(owner,id); } catch (e) { errors.push(String(e)); }
    }
    if (errors.length) throw new Error(errors.slice(0,2).join('; '));
    return sources;
  },
  active(owner: string): string | null {
    return owner ? localStorage.getItem(activeKey(owner)) : null;
  },
  select(owner: string, id: string | null) {
    if (!owner) return;
    if (id) localStorage.setItem(activeKey(owner), id);
    else localStorage.removeItem(activeKey(owner));
  }
};
