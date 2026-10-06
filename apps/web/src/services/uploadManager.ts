import { supabase } from '../lib/supabase'
import { analysisLogger } from './analysisLogger'

export type VideoProcessingStatus = 
  | 'created'
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'paused'

export interface ActiveUpload {
  videoId: string
  fileName: string
  fileSize: number
  progress: number
  status: VideoProcessingStatus
  storagePath: string
  error: string | null
  createdTimestamp: string
  localPreviewUrl: string | null
}

type UploadListener = (upload: ActiveUpload) => void

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
    if (!this.listeners.has(videoId)) {
      this.listeners.set(videoId, new Set())
    }
    this.listeners.get(videoId)!.add(listener)

    const current = this.uploads.get(videoId)
    if (current) {
      try { listener(current) } catch {}
    }

    return () => {
      this.listeners.get(videoId)?.delete(listener)
    }
  }

  private notify(upload: ActiveUpload) {
    const list = this.listeners.get(upload.videoId)
    if (list) {
      list.forEach(l => {
        try { l({ ...upload }) } catch {}
      })
    }
  }

  public updateStatus(videoId: string, status: VideoProcessingStatus, error?: string | null) {
    const upload = this.uploads.get(videoId)
    if (upload) {
      upload.status = status
      if (error !== undefined) upload.error = error
      this.notify(upload)
    }
  }

  /**
   * Starts a resilient background upload that persists and continues across route navigation.
   */
  public async startUpload(
    file: File,
    existingVideoId?: string
  ): Promise<{ videoId: string; storagePath: string; localPreviewUrl: string }> {
    const fileExt = file.name.split('.').pop() || 'mp4'
    const localUrl = URL.createObjectURL(file)
    const timestamp = new Date().toISOString()

    let videoId = existingVideoId

    // 1. Create video_assets database record first if not already present
    if (!videoId) {
      const initialRecord = {
        filename: file.name,
        storage_path: '',
        file_size: file.size,
        processing_status: 'pending' as const,
        metadata: { client_uploaded_at: timestamp, upload_status: 'uploading' }
      }

      analysisLogger.log({
        category: 'SYSTEM',
        message: `Video asset initialization: ${file.name}`
      })

      const { data: assetData, error: assetErr } = await (supabase as any)
        .from('video_assets')
        .insert(initialRecord)
        .select()
        .single()

      if (assetErr || !assetData) {
        analysisLogger.log({
          category: 'ERROR',
          message: `Failed to create video record: ${assetErr?.message || 'Database insert failed'}`
        })
        throw new Error(`Failed to create video record: ${assetErr?.message || 'Database insert failed'}`)
      }

      videoId = assetData.id
    }

    const storagePath = `${videoId}.${fileExt}`

    const activeRecord: ActiveUpload = {
      videoId: videoId!,
      fileName: file.name,
      fileSize: file.size,
      progress: 10,
      status: 'uploading',
      storagePath,
      error: null,
      createdTimestamp: timestamp,
      localPreviewUrl: localUrl
    }

    this.uploads.set(videoId!, activeRecord)
    this.notify(activeRecord)

    analysisLogger.log({
      video_id: videoId,
      category: 'UPLOAD',
      message: `Video asset created (ID: ${videoId})`
    })

    // 2. Perform the Storage upload asynchronously in background
    // This runs independently of any React component mount lifecycle!
    this.executeStorageUpload(file, videoId!, storagePath, activeRecord)

    return {
      videoId: videoId!,
      storagePath,
      localPreviewUrl: localUrl
    }
  }

  private async executeStorageUpload(
    file: File,
    videoId: string,
    storagePath: string,
    uploadRecord: ActiveUpload
  ) {
    try {
      // Keep DB record in 'pending' processing_status (which satisfies DB constraint) and record upload_status in metadata
      try {
        await (supabase as any)
          .from('video_assets')
          .update({
            processing_status: 'pending',
            metadata: { upload_status: 'uploading', client_uploaded_at: uploadRecord.createdTimestamp }
          })
          .eq('id', videoId)
      } catch (dbErr) {
        console.warn('Initial status update warning:', dbErr)
      }

      analysisLogger.log({
        video_id: videoId,
        category: 'UPLOAD',
        message: `Upload started: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`
      })

      uploadRecord.progress = 25
      this.notify(uploadRecord)

      // Simulate realistic upload progress progression while network stream is in flight
      const progressTimer = setInterval(() => {
        if (uploadRecord.status === 'uploading' && uploadRecord.progress < 85) {
          uploadRecord.progress += 15
          this.notify(uploadRecord)
          analysisLogger.log({
            video_id: videoId,
            category: 'UPLOAD',
            message: `Upload ${uploadRecord.progress}% complete`
          })
        }
      }, 500)

      // Actual Supabase Storage Upload
      const { error: uploadErr } = await supabase.storage.from('videos').upload(storagePath, file, {
        upsert: true,
        contentType: file.type || 'video/mp4'
      })

      clearInterval(progressTimer)

      if (uploadErr) {
        uploadRecord.status = 'failed'
        uploadRecord.error = uploadErr.message
        this.notify(uploadRecord)

        await (supabase as any)
          .from('video_assets')
          .update({ processing_status: 'failed' })
          .eq('id', videoId)

        analysisLogger.log({
          video_id: videoId,
          category: 'ERROR',
          message: `Storage upload failed: ${uploadErr.message}`
        })
        return
      }

      uploadRecord.progress = 100
      uploadRecord.status = 'uploaded'
      this.notify(uploadRecord)

      // Update video_assets with final storage_path and 'pending' status (ready for AI processing)
      const { error: updateErr } = await (supabase as any)
        .from('video_assets')
        .update({
          storage_path: storagePath,
          processing_status: 'pending',
          metadata: { upload_status: 'uploaded', completed_at: new Date().toISOString() }
        })
        .eq('id', videoId)

      if (updateErr) {
        console.warn('Failed to update video record status after upload:', updateErr)
      }

      analysisLogger.log({
        video_id: videoId,
        category: 'UPLOAD',
        message: `Upload completed successfully (${storagePath})`
      })

    } catch (err: any) {
      console.error('Background upload exception:', err)
      uploadRecord.status = 'failed'
      uploadRecord.error = err?.message || 'Upload failed'
      this.notify(uploadRecord)

      analysisLogger.log({
        video_id: videoId,
        category: 'ERROR',
        message: `Upload error: ${err?.message || 'Upload failed'}`
      })

      try {
        await (supabase as any)
          .from('video_assets')
          .update({ processing_status: 'failed' })
          .eq('id', videoId)
      } catch {}
    }
  }
}

export const uploadManager = new UploadManagerService()
