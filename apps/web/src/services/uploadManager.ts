import * as tus from 'tus-js-client'
import { supabase, supabaseConfig } from '../lib/supabase'
import type { UploadStatus } from '../lib/videoAssets'
import type { Json } from '../types/supabase'
import { analysisLogger } from './analysisLogger'

export interface ActiveUpload {
  videoId: string
  fileName: string
  fileSize: number
  /** Bytes sent so far, as reported by the upload transport (never simulated). */
  bytesUploaded: number
  /** 0–100, derived from bytesUploaded / fileSize. */
  progress: number
  status: UploadStatus
  storagePath: string
  error: string | null
  createdTimestamp: string
  /** Object URL for immediate playback in this tab. The Storage copy is canonical. */
  localPreviewUrl: string
}

type UploadListener = (upload: ActiveUpload) => void

const VIDEOS_BUCKET = 'videos'
// Supabase resumable uploads require exactly 6 MB chunks.
const TUS_CHUNK_SIZE = 6 * 1024 * 1024
const PROGRESS_NOTIFY_INTERVAL_MS = 250

/**
 * Owns uploads outside the React tree so they survive route changes and Analyze remounts.
 *
 * Sequence: video_assets row (processing_status 'pending', metadata.upload_status 'uploading')
 * → resumable TUS upload to videos/<video_id>/original.<ext> (6 MB chunks, per-chunk retry, real
 * progress) → row updated with storage_path + upload_status 'uploaded'. Any failure marks the row
 * 'failed' with the real error and is logged as ERROR.
 */
class UploadManagerService {
  private uploads = new Map<string, ActiveUpload>()
  private listeners = new Map<string, Set<UploadListener>>()
  private lastNotify = new Map<string, number>()

  constructor() {
    if (typeof window !== 'undefined') {
      // A full page unload kills in-flight uploads; warn instead of losing them silently.
      window.addEventListener('beforeunload', (e) => {
        if (this.getAllUploads().some(u => u.status === 'uploading')) {
          e.preventDefault()
          e.returnValue = ''
        }
      })
    }
  }

  public getUpload(videoId: string): ActiveUpload | null {
    return this.uploads.get(videoId) || null
  }

  public getAllUploads(): ActiveUpload[] {
    return Array.from(this.uploads.values())
  }

  public subscribe(videoId: string, listener: UploadListener): () => void {
    let set = this.listeners.get(videoId)
    if (!set) {
      set = new Set()
      this.listeners.set(videoId, set)
    }
    set.add(listener)

    const current = this.uploads.get(videoId)
    if (current) {
      try { listener({ ...current }) } catch (e) { console.warn('Upload listener failed:', e) }
    }

    return () => { set.delete(listener) }
  }

  private notify(upload: ActiveUpload) {
    this.lastNotify.set(upload.videoId, performance.now())
    this.listeners.get(upload.videoId)?.forEach(l => {
      try { l({ ...upload }) } catch (e) { console.warn('Upload listener failed:', e) }
    })
  }

  /**
   * Creates the video_assets row, then uploads to Storage in the background.
   * Resolves as soon as the row exists (with its video_id); rejects with the real error otherwise.
   */
  public async startUpload(file: File, selectedAt: string = new Date().toISOString()): Promise<{ videoId: string; storagePath: string; localPreviewUrl: string }> {
    const fileExt = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
    const contentType = file.type || 'video/mp4'
    const baseMetadata: Record<string, Json> = {
      client_uploaded_at: selectedAt,
      original_filename: file.name,
      content_type: contentType
    }

    const { data: assetData, error: assetErr } = await supabase
      .from('video_assets')
      .insert({
        filename: file.name,
        storage_path: '',
        file_size: file.size,
        processing_status: 'pending',
        metadata: { ...baseMetadata, upload_status: 'uploading' }
      })
      .select()
      .single()

    if (assetErr || !assetData) {
      throw new Error(`Failed to create video record: ${assetErr?.message || 'database insert returned no row'}`)
    }

    const videoId: string = assetData.id
    // One object per asset, keyed by its id: two uploads can never share or overwrite a path.
    const storagePath = `${videoId}/original.${fileExt}`
    const record: ActiveUpload = {
      videoId,
      fileName: file.name,
      fileSize: file.size,
      bytesUploaded: 0,
      progress: 0,
      status: 'uploading',
      storagePath,
      error: null,
      createdTimestamp: selectedAt,
      localPreviewUrl: URL.createObjectURL(file)
    }
    this.uploads.set(videoId, record)
    this.notify(record)

    const sizeMb = (file.size / (1024 * 1024)).toFixed(2)
    analysisLogger.log({ video_id: videoId, category: 'UPLOAD', timestamp: selectedAt, message: `File selected: ${file.name} (${sizeMb} MB, ${contentType})` })
    analysisLogger.log({ video_id: videoId, category: 'UPLOAD', message: `Video asset created (id ${videoId})` })

    // Detached from any component lifecycle on purpose.
    void this.executeStorageUpload(file, record, baseMetadata, contentType)

    return { videoId, storagePath, localPreviewUrl: record.localPreviewUrl }
  }

  private async markFailed(record: ActiveUpload, message: string, baseMetadata: Record<string, Json>) {
    record.status = 'failed'
    record.error = message
    this.notify(record)

    analysisLogger.log({ video_id: record.videoId, category: 'ERROR', message: `Upload failed: ${message}` })

    const { error } = await supabase
      .from('video_assets')
      .update({
        processing_status: 'failed',
        metadata: { ...baseMetadata, upload_status: 'failed', upload_error: message }
      })
      .eq('id', record.videoId)
    if (error) {
      console.error('Failed to record upload failure on video_assets:', error)
      analysisLogger.log({ video_id: record.videoId, category: 'ERROR', message: `Could not record upload failure on video_assets: ${error.message}` })
    }
  }

  private async executeStorageUpload(file: File, record: ActiveUpload, baseMetadata: Record<string, Json>, contentType: string) {
    const { videoId, storagePath } = record
    const totalMb = (file.size / (1024 * 1024)).toFixed(1)
    analysisLogger.log({ video_id: videoId, category: 'UPLOAD', message: `Upload started → ${VIDEOS_BUCKET}/${storagePath} (${totalMb} MB, resumable)` })

    try {
      if (supabaseConfig.isMock) {
        const { error } = await supabase.storage.from(VIDEOS_BUCKET).upload(storagePath, file, { upsert: false, contentType })
        if (error) throw error
      } else {
        await this.tusUpload(file, record, contentType)
      }
    } catch (err) {
      console.error('Storage upload failed:', err)
      await this.markFailed(record, describeUploadError(err), baseMetadata)
      return
    }

    const { error: updateErr } = await supabase
      .from('video_assets')
      .update({
        storage_path: storagePath,
        metadata: { ...baseMetadata, upload_status: 'uploaded', upload_completed_at: new Date().toISOString() }
      })
      .eq('id', videoId)
    if (updateErr) {
      await this.markFailed(record, `file stored at ${VIDEOS_BUCKET}/${storagePath}, but video_assets update failed: ${updateErr.message}`, baseMetadata)
      return
    }

    record.bytesUploaded = record.fileSize
    record.progress = 100
    record.status = 'uploaded'
    this.notify(record)
    analysisLogger.log({ video_id: videoId, category: 'UPLOAD', message: `Upload completed: ${VIDEOS_BUCKET}/${storagePath}` })
  }

  private tusUpload(file: File, record: ActiveUpload, contentType: string): Promise<void> {
    const { videoId, storagePath } = record
    let lastLoggedDecile = 0

    return new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `${supabaseConfig.url}/storage/v1/upload/resumable`,
        chunkSize: TUS_CHUNK_SIZE,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        headers: {
          apikey: supabaseConfig.anonKey,
          'x-upsert': 'false'
        },
        metadata: {
          bucketName: VIDEOS_BUCKET,
          objectName: storagePath,
          contentType,
          cacheControl: '3600'
        },
        // Long uploads can outlive an access token: attach the current (auto-refreshed) one to every request.
        onBeforeRequest: async (req) => {
          const { data, error } = await supabase.auth.getSession()
          if (error || !data.session) throw new Error(`Not authenticated for upload: ${error?.message ?? 'no active session'}`)
          req.setHeader('authorization', `Bearer ${data.session.access_token}`)
        },
        onProgress: (bytesSent, bytesTotal) => {
          record.bytesUploaded = bytesSent
          record.progress = bytesTotal > 0 ? Math.floor((bytesSent / bytesTotal) * 100) : 0
          if (performance.now() - (this.lastNotify.get(videoId) ?? 0) >= PROGRESS_NOTIFY_INTERVAL_MS) this.notify(record)
        },
        // Logged progress uses bytes the server has acknowledged.
        onChunkComplete: (_chunk, bytesAccepted, bytesTotal) => {
          const decile = Math.floor((bytesAccepted / bytesTotal) * 10)
          if (decile > lastLoggedDecile && decile < 10) {
            lastLoggedDecile = decile
            analysisLogger.log({
              video_id: videoId,
              category: 'UPLOAD',
              message: `Upload progress: ${decile * 10}% (${(bytesAccepted / (1024 * 1024)).toFixed(1)} / ${(bytesTotal / (1024 * 1024)).toFixed(1)} MB stored)`
            })
          }
        },
        onError: (error) => reject(error),
        onSuccess: () => resolve()
      })
      upload.start()
    })
  }
}

function describeUploadError(err: unknown): string {
  if (err instanceof tus.DetailedError && err.originalResponse) {
    const status = err.originalResponse.getStatus()
    const body = err.originalResponse.getBody()
    let detail = body
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string }
      detail = parsed.message || parsed.error || body
    } catch {
      // body is not JSON; keep it verbatim
    }
    const hint = status === 413 ? ' — the file exceeds the Supabase Storage upload size limit for this project' : ''
    return `HTTP ${status}: ${detail || err.message}${hint}`
  }
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return String(err)
}

export const uploadManager = new UploadManagerService()
