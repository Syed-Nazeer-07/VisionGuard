import { supabase } from '../lib/supabase'

export type LogCategory = 
  | 'SYSTEM'
  | 'UPLOAD'
  | 'PROCESSING'
  | 'MODEL'
  | 'DETECTION'
  | 'TRACKING'
  | 'INCIDENT'
  | 'EVIDENCE'
  | 'PERSISTENCE'
  | 'ERROR'

export interface AnalysisLogEntry {
  id?: string
  video_id?: string | null
  camera_id?: string | null
  analysis_run_id?: string | null
  timestamp: string // ISO string or formatted HH:mm:ss
  category: LogCategory
  message: string
  metadata?: Record<string, any>
}

type LogListener = (entry: AnalysisLogEntry) => void

class AnalysisLoggerService {
  private inMemoryLogs = new Map<string, AnalysisLogEntry[]>()
  private listeners = new Map<string, Set<LogListener>>()
  private lastDetectionLogTime = 0

  private getKey(videoId?: string | null, cameraId?: string | null): string {
    if (videoId) return `video:${videoId}`
    if (cameraId) return `camera:${cameraId}`
    return 'global'
  }

  public subscribe(videoId: string | null | undefined, cameraId: string | null | undefined, listener: LogListener): () => void {
    const key = this.getKey(videoId, cameraId)
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    this.listeners.get(key)!.add(listener)

    return () => {
      this.listeners.get(key)?.delete(listener)
    }
  }

  public getCachedLogs(videoId?: string | null, cameraId?: string | null): AnalysisLogEntry[] {
    const key = this.getKey(videoId, cameraId)
    const inMem = this.inMemoryLogs.get(key)
    if (inMem && inMem.length > 0) return inMem

    try {
      const stored = localStorage.getItem(`visionguard_logs_${key}`)
      if (stored) {
        const parsed: AnalysisLogEntry[] = JSON.parse(stored)
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.inMemoryLogs.set(key, parsed)
          return parsed
        }
      }
    } catch {}

    return []
  }

  public async fetchHistoricalLogs(videoId?: string | null, cameraId?: string | null): Promise<AnalysisLogEntry[]> {
    if (!videoId && !cameraId) return []

    const key = this.getKey(videoId, cameraId)
    const local = this.getCachedLogs(videoId, cameraId)

    try {
      let query = (supabase as any).from('analysis_logs').select('*')
      if (videoId) {
        query = query.eq('video_id', videoId)
      } else if (cameraId) {
        query = query.eq('camera_id', cameraId)
      }

      const { data, error } = await query.order('timestamp', { ascending: true }).limit(200)

      if (!error && data && data.length > 0) {
        const dbLogs: AnalysisLogEntry[] = data.map((row: any) => ({
          id: row.id,
          video_id: row.video_id,
          camera_id: row.camera_id,
          analysis_run_id: row.analysis_run_id,
          timestamp: row.timestamp,
          category: row.category,
          message: row.message,
          metadata: row.metadata
        }))

        // Merge with local logs avoiding duplicates
        const existingMessages = new Set(dbLogs.map(l => `${l.timestamp}_${l.message}`))
        const combined = [...dbLogs]
        for (const loc of local) {
          if (!existingMessages.has(`${loc.timestamp}_${loc.message}`)) {
            combined.push(loc)
          }
        }
        combined.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        this.inMemoryLogs.set(key, combined)
        try {
          localStorage.setItem(`visionguard_logs_${key}`, JSON.stringify(combined.slice(-100)))
        } catch {}
        return combined
      }
    } catch (e) {
      console.warn('Error fetching analysis logs from DB:', e)
    }

    // If local logs exist in localStorage / memory, return them
    if (local.length > 0) {
      return local
    }

    // If no logs exist yet for this video/camera, reconstruct historical event timeline from persistent records
    if (videoId) {
      try {
        const reconstructed: AnalysisLogEntry[] = []
        const { data: asset } = await (supabase as any).from('video_assets').select('*').eq('id', videoId).maybeSingle()
        if (asset) {
          const createdTime = asset.uploaded_at || new Date().toISOString()
          reconstructed.push({
            video_id: videoId,
            timestamp: createdTime,
            category: 'SYSTEM',
            message: `Video asset registered: ${asset.filename} (${asset.file_size ? `${(asset.file_size / (1024 * 1024)).toFixed(2)} MB` : 'MP4'})`
          })
          if (asset.storage_path) {
            reconstructed.push({
              video_id: videoId,
              timestamp: new Date(new Date(createdTime).getTime() + 1500).toISOString(),
              category: 'UPLOAD',
              message: `Storage upload verified (${asset.storage_path})`
            })
          }
        }

        // Fetch persisted incidents for this video
        const { data: incs } = await (supabase as any)
          .from('incidents')
          .select('*')
          .eq('video_id', videoId)
          .order('created_at', { ascending: true })

        if (incs && incs.length > 0) {
          reconstructed.push({
            video_id: videoId,
            timestamp: incs[0].created_at || new Date().toISOString(),
            category: 'PROCESSING',
            message: `Inference pipeline active (${incs.length} incident checkpoint${incs.length > 1 ? 's' : ''} saved)`
          })

          incs.forEach((inc: any) => {
            reconstructed.push({
              video_id: videoId,
              timestamp: inc.created_at || new Date().toISOString(),
              category: 'INCIDENT',
              message: `Incident recorded: ${inc.incident_type || inc.type} (Severity: ${inc.severity || 'Medium'})`
            })
          })
        }

        if (asset?.processing_status === 'completed') {
          reconstructed.push({
            video_id: videoId,
            timestamp: asset.metadata?.completed_at || new Date().toISOString(),
            category: 'PROCESSING',
            message: `Video analysis run completed`
          })
        }

        if (reconstructed.length > 0) {
          this.inMemoryLogs.set(key, reconstructed)
          try {
            localStorage.setItem(`visionguard_logs_${key}`, JSON.stringify(reconstructed))
          } catch {}
          return reconstructed
        }
      } catch (err) {
        console.warn('Failed to reconstruct historical logs:', err)
      }
    }

    return []
  }

  public log(entry: Omit<AnalysisLogEntry, 'timestamp'> & { timestamp?: string }): AnalysisLogEntry {
    const fullEntry: AnalysisLogEntry = {
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString()
    }

    const key = this.getKey(fullEntry.video_id, fullEntry.camera_id)
    if (!this.inMemoryLogs.has(key)) {
      this.inMemoryLogs.set(key, [])
    }
    const list = this.inMemoryLogs.get(key)!
    list.push(fullEntry)

    // Keep persistent storage up to date
    try {
      localStorage.setItem(`visionguard_logs_${key}`, JSON.stringify(list.slice(-100)))
    } catch {}

    // Notify active UI listeners immediately
    const keyListeners = this.listeners.get(key)
    if (keyListeners) {
      keyListeners.forEach(listener => {
        try { listener(fullEntry) } catch {}
      })
    }

    // Persist to Supabase in the background
    if (fullEntry.video_id || fullEntry.camera_id) {
      this.persistToDatabase(fullEntry)
    }

    return fullEntry
  }

  // Throttled detection logger to avoid spamming the database with 30 logs/sec
  public logDetection(
    videoId: string | null | undefined, 
    cameraId: string | null | undefined, 
    runId: string | null | undefined, 
    message: string, 
    metadata?: Record<string, any>
  ) {
    const now = performance.now()
    // Throttle individual detection log persistence to at most once every 1.5 seconds per stream
    if (now - this.lastDetectionLogTime > 1500) {
      this.lastDetectionLogTime = now
      this.log({
        video_id: videoId || null,
        camera_id: cameraId || null,
        analysis_run_id: runId || null,
        category: 'DETECTION',
        message,
        metadata
      })
    }
  }

  private async persistToDatabase(entry: AnalysisLogEntry) {
    try {
      const { data, error } = await (supabase as any)
        .from('analysis_logs')
        .insert({
          video_id: entry.video_id || null,
          camera_id: entry.camera_id || null,
          analysis_run_id: entry.analysis_run_id || null,
          category: entry.category,
          message: entry.message,
          timestamp: entry.timestamp,
          metadata: entry.metadata || {}
        })
        .select('id')
        .single()

      if (data?.id) {
        entry.id = data.id
      }
      if (error) {
        console.warn('Failed to persist analysis log:', error)
      }
    } catch (e) {
      console.warn('Analysis log persistence exception:', e)
    }
  }
}

export const analysisLogger = new AnalysisLoggerService()
