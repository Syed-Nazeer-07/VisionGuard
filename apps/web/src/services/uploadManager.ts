import { supabase } from '../lib/supabase'
import type { UploadStatus } from '../lib/videoAssets'
import type { Json } from '../types/supabase'
import { analysisLogger } from './analysisLogger'
import { storageProviderFor, uploadStorageProvider, type StorageProviderId, type UploadProgress } from './videoStorage'

export interface ActiveUpload {
  videoId: string
  fileName: string
  fileSize: number
  provider: StorageProviderId
  providerLabel: string
  /** Bytes sent so far, as reported by the transport (never simulated). */
  bytesUploaded: number
  /** Bytes the storage service has confirmed as stored. */
  bytesStored: number
  /** 0–100, derived from bytesUploaded / fileSize. */
  progress: number
  /** Measured over the last few seconds; null until there is enough data. */
  bytesPerSecond: number | null
  etaSeconds: number | null
  status: UploadStatus
  storagePath: string | null
  error: string | null
  createdTimestamp: string
  /** Object URL for immediate playback in this tab (null once released). The stored copy is canonical. */
  localPreviewUrl: string | null
}

type UploadListener = (upload: ActiveUpload) => void
type Metadata = Record<string, Json | undefined>

const PROGRESS_NOTIFY_INTERVAL_MS = 250
const SPEED_WINDOW_MS = 8000

/**
 * Owns uploads outside the React tree so they survive SPA route changes and Analyze remounts.
 *
 * Sequence: video_assets row (processing_status 'pending', storage_provider, metadata.upload_status
 * 'uploading') → provider upload (B2 multipart by default) → row updated with storage_path +
 * upload_status 'uploaded'. Failures mark the row upload_status 'failed' with the real error.
 */
class UploadManagerService {
  private uploads = new Map<string, ActiveUpload>()
  private listeners = new Map<string, Set<UploadListener>>()
  private lastNotify = new Map<string, number>()
  private samples = new Map<string, Array<{ t: number; bytes: number }>>()

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

  /**
   * Revoke the local preview URL when nothing needs it any more. While the transfer is still running
   * the local copy is the only playable source for that video, so it is kept until the upload ends.
   */
  public releasePreview(videoId: string): boolean {
    const upload = this.uploads.get(videoId)
    if (!upload?.localPreviewUrl || upload.status === 'uploading') return false
    URL.revokeObjectURL(upload.localPreviewUrl)
    upload.localPreviewUrl = null
    this.notify(upload)
    return true
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
   * Creates the video_assets row, then uploads in the background.
   * Resolves as soon as the row exists (with its video_id); rejects with the real error otherwise.
   */
  public async startUpload(file: File, selectedAt: string = new Date().toISOString()): Promise<{ videoId: string }> {
    const provider = uploadStorageProvider()
    const contentType = file.type || 'video/mp4'
    const baseMetadata: Metadata = {
      client_uploaded_at: selectedAt,
      original_filename: file.name,
      content_type: contentType
    }

    const { data: assetData, error: assetErr } = await supabase
      .from('video_assets')
      .insert({
        filename: file.name,
        storage_path: '',
        storage_provider: provider.id,
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
    const record: ActiveUpload = {
      videoId,
      fileName: file.name,
      fileSize: file.size,
      provider: provider.id,
      providerLabel: provider.label,
      bytesUploaded: 0,
      bytesStored: 0,
      progress: 0,
      bytesPerSecond: null,
      etaSeconds: null,
      status: 'uploading',
      storagePath: null,
      error: null,
      createdTimestamp: selectedAt,
      localPreviewUrl: URL.createObjectURL(file)
    }
    this.uploads.set(videoId, record)
    this.notify(record)

    analysisLogger.log({ video_id: videoId, category: 'UPLOAD', timestamp: selectedAt, message: `File selected: ${file.name} (${mb(file.size)}, ${contentType})` })
    analysisLogger.log({ video_id: videoId, category: 'UPLOAD', message: `Video asset created (id ${videoId}, storage: ${provider.label})` })

    // Detached from any component lifecycle on purpose.
    void this.executeUpload(file, record)

    return { videoId }
  }

  /** Merge into the row's current metadata so server-written keys (e.g. the B2 upload session) survive. */
  private async updateAsset(videoId: string, patch: Record<string, Json>, metadataPatch: Metadata): Promise<string | null> {
    const { data: current, error: readErr } = await supabase.from('video_assets').select('metadata').eq('id', videoId).maybeSingle()
    if (readErr) return readErr.message
    const existing = current?.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata) ? current.metadata as Metadata : {}
    const { error } = await supabase
      .from('video_assets')
      .update({ ...patch, metadata: { ...existing, ...metadataPatch } })
      .eq('id', videoId)
    return error ? error.message : null
  }

  private async markFailed(record: ActiveUpload, message: string) {
    record.status = 'failed'
    record.error = message
    record.bytesPerSecond = null
    record.etaSeconds = null
    this.notify(record)

    analysisLogger.log({ video_id: record.videoId, category: 'ERROR', message: `Upload failed: ${message}` })

    const updateErr = await this.updateAsset(record.videoId, { processing_status: 'failed' }, {
      upload_status: 'failed',
      upload_error: message,
      upload_failed_at: new Date().toISOString()
    })
    if (updateErr) {
      console.error('Failed to record upload failure on video_assets:', updateErr)
      analysisLogger.log({ video_id: record.videoId, category: 'ERROR', message: `Could not record upload failure on video_assets: ${updateErr}` })
    }
  }

  private onProgress(record: ActiveUpload, p: UploadProgress, loggedDecile: { value: number }) {
    const now = performance.now()
    record.bytesUploaded = p.bytesSent
    record.bytesStored = p.bytesStored
    record.progress = p.bytesTotal > 0 ? Math.floor((p.bytesSent / p.bytesTotal) * 100) : 0

    const samples = this.samples.get(record.videoId) ?? []
    samples.push({ t: now, bytes: p.bytesSent })
    while (samples.length > 2 && now - samples[0].t > SPEED_WINDOW_MS) samples.shift()
    this.samples.set(record.videoId, samples)
    const first = samples[0]
    const elapsed = (now - first.t) / 1000
    if (elapsed >= 2 && p.bytesSent > first.bytes) {
      record.bytesPerSecond = (p.bytesSent - first.bytes) / elapsed
      record.etaSeconds = Math.round((p.bytesTotal - p.bytesSent) / record.bytesPerSecond)
    }

    const decile = Math.floor((p.bytesStored / p.bytesTotal) * 10)
    if (decile > loggedDecile.value && decile < 10) {
      loggedDecile.value = decile
      analysisLogger.log({
        video_id: record.videoId,
        category: 'UPLOAD',
        message: `Upload progress: ${decile * 10}% (${mb(p.bytesStored)} of ${mb(p.bytesTotal)} stored${record.bytesPerSecond ? `, ${mb(record.bytesPerSecond)}/s` : ''})`
      })
    }

    if (now - (this.lastNotify.get(record.videoId) ?? 0) >= PROGRESS_NOTIFY_INTERVAL_MS) this.notify(record)
  }

  private async executeUpload(file: File, record: ActiveUpload) {
    const provider = storageProviderFor({ storage_provider: record.provider })
    const { videoId } = record
    const loggedDecile = { value: 0 }
    analysisLogger.log({ video_id: videoId, category: 'UPLOAD', message: `Upload started → ${provider.label} (${mb(file.size)})` })

    let storagePath: string
    try {
      const result = await provider.uploadVideo(file, videoId, {
        onProgress: p => this.onProgress(record, p, loggedDecile),
        onLog: message => analysisLogger.log({ video_id: videoId, category: 'UPLOAD', message })
      })
      storagePath = result.storagePath
    } catch (err) {
      console.error('Video upload failed:', err)
      await this.markFailed(record, err instanceof Error ? err.message : String(err))
      return
    }

    const updateErr = await this.updateAsset(videoId, { storage_path: storagePath, storage_provider: provider.id }, {
      upload_status: 'uploaded',
      upload_completed_at: new Date().toISOString(),
      upload_error: null
    })
    if (updateErr) {
      await this.markFailed(record, `file stored (${provider.label}: ${storagePath}), but video_assets update failed: ${updateErr}`)
      return
    }

    record.storagePath = storagePath
    record.bytesUploaded = record.fileSize
    record.bytesStored = record.fileSize
    record.progress = 100
    record.bytesPerSecond = null
    record.etaSeconds = null
    record.status = 'uploaded'
    this.samples.delete(videoId)
    this.notify(record)
    analysisLogger.log({ video_id: videoId, category: 'UPLOAD', message: `Upload completed: ${provider.label} ${storagePath} (${mb(file.size)})` })
  }
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const uploadManager = new UploadManagerService()
