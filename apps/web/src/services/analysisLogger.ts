import { db } from './db'
import type { AnalysisLogCategory, Json } from '../types/supabase'

export type LogCategory = AnalysisLogCategory

export interface AnalysisLogEntry {
  id: string // client-generated UUID, reused as the analysis_logs primary key
  video_id: string | null
  camera_id: string | null
  analysis_run_id: string | null
  timestamp: string // ISO
  category: LogCategory
  message: string
  metadata: Record<string, Json | undefined>
}

export interface LogInput {
  video_id?: string | null
  camera_id?: string | null
  analysis_run_id?: string | null
  category: LogCategory
  message: string
  metadata?: Record<string, Json | undefined>
}

type LogListener = (entry: AnalysisLogEntry) => void
type PersistenceListener = (error: string | null) => void

const MAX_CACHED_PER_SOURCE = 500

/**
 * Records real pipeline events. Each entry is shown immediately to subscribed panels and written to
 * public.analysis_logs. Nothing is synthesized: if persistence fails, the failure is surfaced
 * (getPersistenceError / ERROR in the console) rather than hidden.
 */
class AnalysisLoggerService {
  private cache = new Map<string, AnalysisLogEntry[]>()
  private listeners = new Map<string, Set<LogListener>>()
  private persistenceListeners = new Set<PersistenceListener>()
  private persistenceError: string | null = null
  private lastDetectionLogTime = new Map<string, number>()

  private key(videoId?: string | null, cameraId?: string | null): string | null {
    if (videoId) return `video:${videoId}`
    if (cameraId) return `camera:${cameraId}`
    return null
  }

  public subscribe(videoId: string | null | undefined, cameraId: string | null | undefined, listener: LogListener): () => void {
    const key = this.key(videoId, cameraId)
    if (!key) return () => {}
    let set = this.listeners.get(key)
    if (!set) {
      set = new Set()
      this.listeners.set(key, set)
    }
    set.add(listener)
    return () => { set.delete(listener) }
  }

  public onPersistenceChange(listener: PersistenceListener): () => void {
    this.persistenceListeners.add(listener)
    listener(this.persistenceError)
    return () => { this.persistenceListeners.delete(listener) }
  }

  public getPersistenceError(): string | null {
    return this.persistenceError
  }

  /** Entries recorded in this browser session for the source (including any not yet persisted). */
  public getSessionLogs(videoId?: string | null, cameraId?: string | null): AnalysisLogEntry[] {
    const key = this.key(videoId, cameraId)
    return key ? [...(this.cache.get(key) ?? [])] : []
  }

  /** Persisted history for the source merged with this session's entries, chronological. */
  public async fetchLogs(videoId?: string | null, cameraId?: string | null): Promise<AnalysisLogEntry[]> {
    if (!videoId && !cameraId) return []
    const rows = await db.analysisLogs.list({ videoId, cameraId })
    const persisted: AnalysisLogEntry[] = rows.map(row => ({
      id: row.id,
      video_id: row.video_id,
      camera_id: row.camera_id,
      analysis_run_id: row.analysis_run_id,
      timestamp: row.timestamp,
      category: row.category,
      message: row.message,
      metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}) as Record<string, Json | undefined>
    }))
    return mergeLogs(persisted, this.getSessionLogs(videoId, cameraId))
  }

  public log(input: LogInput): AnalysisLogEntry {
    const entry: AnalysisLogEntry = {
      id: newUuid(),
      video_id: input.video_id ?? null,
      camera_id: input.camera_id ?? null,
      analysis_run_id: input.analysis_run_id ?? null,
      timestamp: new Date().toISOString(),
      category: input.category,
      message: input.message,
      metadata: input.metadata ?? {}
    }

    const key = this.key(entry.video_id, entry.camera_id)
    if (!key) {
      // Not tied to a source: nothing to attach it to in analysis_logs.
      console.info(`[analysis:${entry.category}] ${entry.message}`)
      return entry
    }

    const list = this.cache.get(key) ?? []
    list.push(entry)
    if (list.length > MAX_CACHED_PER_SOURCE) list.splice(0, list.length - MAX_CACHED_PER_SOURCE)
    this.cache.set(key, list)

    this.listeners.get(key)?.forEach(listener => {
      try { listener(entry) } catch (e) { console.warn('Analysis log listener failed:', e) }
    })

    void this.persist(entry)
    return entry
  }

  /** Detection events are frequent; record at most one every 1.5s per source. */
  public logDetection(
    videoId: string | null | undefined,
    cameraId: string | null | undefined,
    runId: string | null | undefined,
    message: string,
    metadata?: Record<string, Json | undefined>
  ) {
    const key = this.key(videoId, cameraId)
    if (!key) return
    const now = performance.now()
    if (now - (this.lastDetectionLogTime.get(key) ?? 0) < 1500) return
    this.lastDetectionLogTime.set(key, now)
    this.log({ video_id: videoId, camera_id: cameraId, analysis_run_id: runId, category: 'DETECTION', message, metadata })
  }

  private setPersistenceError(error: string | null) {
    if (error === this.persistenceError) return
    this.persistenceError = error
    this.persistenceListeners.forEach(l => {
      try { l(error) } catch (e) { console.warn('Analysis log persistence listener failed:', e) }
    })
  }

  private async persist(entry: AnalysisLogEntry) {
    try {
      await db.analysisLogs.create({
        id: entry.id,
        video_id: entry.video_id,
        camera_id: entry.camera_id,
        analysis_run_id: entry.analysis_run_id,
        timestamp: entry.timestamp,
        category: entry.category,
        message: entry.message,
        metadata: entry.metadata as Json
      })
      this.setPersistenceError(null)
    } catch (e) {
      const message = describeError(e)
      console.error('Failed to persist analysis log:', message, e)
      this.setPersistenceError(message)
    }
  }
}

export function mergeLogs(...lists: AnalysisLogEntry[][]): AnalysisLogEntry[] {
  const byId = new Map<string, AnalysisLogEntry>()
  for (const list of lists) for (const entry of list) byId.set(entry.id, entry)
  return Array.from(byId.values()).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

// crypto.randomUUID() only exists in secure contexts; the dev server is also reached over plain http on the LAN.
function newUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function describeError(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { message?: unknown; code?: unknown }
    const code = typeof err.code === 'string' ? ` [${err.code}]` : ''
    if (typeof err.message === 'string') return `${err.message}${code}`
  }
  return String(e)
}

export const analysisLogger = new AnalysisLoggerService()
