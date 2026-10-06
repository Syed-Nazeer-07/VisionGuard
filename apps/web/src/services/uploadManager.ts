import { supabase } from '../lib/supabase'
import type { UploadStatus } from '../lib/videoAssets'
import type { Json } from '../types/supabase'
import { analysisLogger } from './analysisLogger'

export interface ActiveUpload {
  videoId: string
  fileName: string
  fileSize: number
  /** Coarse phase progress: 10 = record created, 25 = transfer in flight, 100 = stored. */
  progress: number
  status: UploadStatus
  storagePath: string
  error: string | null
  createdTimestamp: string
  /** Object URL for immediate playback in this tab. The Storage copy is canonical. */
  localPreviewUrl: string
}

type UploadListener = (upload: ActiveUpload) => void

/**
 * Owns uploads outside the React tree so they survive route changes and Analyze remounts.
 * video_assets.processing_status stays within the DB lifecycle (pending/processing/completed/failed/paused);
 * the transfer state lives in video_assets.metadata.upload_status.
 */
class UploadManagerService {
  private uploads = new Map<string, ActiveUpload>()
  private listeners = new Map<string, Set<UploadListener>>()

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
    this.listeners.get(upload.videoId)?.forEach(l => {
      try { l({ ...upload }) } catch (e) { console.warn('Upload listener failed:', e) }
    })
  }

  /** Creates the video_assets row, then uploads to Storage in the background. Resolves once the row exists. */
  public async startUpload(file: File): Promise<{ videoId: string; storagePath: string; localPreviewUrl: string }> {
    const fileExt = (file.name.split('.').pop() || 'mp4').toLowerCase()
    const createdTimestamp = new Date().toISOString()
    const baseMetadata = { client_uploaded_at: createdTimestamp, original_filename: file.name, content_type: file.type || 'video/mp4' }

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
    const storagePath = `${videoId}.${fileExt}`
    const record: ActiveUpload = {
      videoId,
      fileName: file.name,
      fileSize: file.size,
      progress: 10,
      status: 'uploading',
      storagePath,
      error: null,
      createdTimestamp,
      localPreviewUrl: URL.createObjectURL(file)
    }
    this.uploads.set(videoId, record)
    this.notify(record)

    analysisLogger.log({
      video_id: videoId,
      category: 'UPLOAD',
      message: `Video asset created: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`
    })

    // Detached from any component lifecycle on purpose.
    void this.executeStorageUpload(file, record, baseMetadata)

    return { videoId, storagePath, localPreviewUrl: record.localPreviewUrl }
  }

  private async markFailed(record: ActiveUpload, message: string, baseMetadata: Record<string, Json>) {
    record.status = 'failed'
    record.error = message
    this.notify(record)

    analysisLogger.log({ video_id: record.videoId, category: 'ERROR', message: `Storage upload failed: ${message}` })

    const { error } = await supabase
      .from('video_assets')
      .update({
        processing_status: 'failed',
        metadata: { ...baseMetadata, upload_status: 'failed', upload_error: message }
      })
      .eq('id', record.videoId)
    if (error) console.error('Failed to record upload failure on video_assets:', error)
  }

  private async executeStorageUpload(file: File, record: ActiveUpload, baseMetadata: Record<string, Json>) {
    const { videoId, storagePath } = record
    try {
      record.progress = 25
      this.notify(record)
      analysisLogger.log({ video_id: videoId, category: 'UPLOAD', message: `Upload started → videos/${storagePath}` })

      const { error: uploadErr } = await supabase.storage.from('videos').upload(storagePath, file, {
        upsert: true,
        contentType: file.type || 'video/mp4'
      })
      if (uploadErr) {
        await this.markFailed(record, uploadErr.message, baseMetadata)
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
        await this.markFailed(record, `stored, but video_assets update failed: ${updateErr.message}`, baseMetadata)
        return
      }

      record.progress = 100
      record.status = 'uploaded'
      this.notify(record)
      analysisLogger.log({ video_id: videoId, category: 'UPLOAD', message: `Upload completed (videos/${storagePath})` })
    } catch (err) {
      console.error('Background upload exception:', err)
      await this.markFailed(record, err instanceof Error ? err.message : String(err), baseMetadata)
    }
  }
}

export const uploadManager = new UploadManagerService()
