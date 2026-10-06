import * as tus from 'tus-js-client'
import { supabase, supabaseConfig } from '../lib/supabase'
import type { VideoAsset } from './db'

/**
 * Physical storage for uploaded videos, behind one interface. The UI and uploadManager only deal
 * with video_assets rows; which provider holds the bytes is recorded in video_assets.storage_provider.
 *
 *   b2       — Backblaze B2 (default for new uploads). Credentials live only in the `video-storage`
 *              Edge Function; the browser receives short-lived presigned URLs.
 *   supabase — Supabase Storage bucket `videos` (legacy assets; subject to the project's per-file limit).
 */
export type StorageProviderId = 'supabase' | 'b2'

export interface UploadProgress {
  /** Bytes sent by the browser so far (includes in-flight parts). */
  bytesSent: number
  /** Bytes the storage service has confirmed as stored. */
  bytesStored: number
  bytesTotal: number
}

export interface UploadHooks {
  onProgress: (p: UploadProgress) => void
  onLog: (message: string) => void
}

export interface StoredObjectInfo {
  exists: boolean
  size: number | null
}

export interface VideoStorageProvider {
  readonly id: StorageProviderId
  readonly label: string
  /** Uploads the file for an existing video_assets row. Resolves with the stored object path. */
  uploadVideo(file: File, videoId: string, hooks: UploadHooks): Promise<{ storagePath: string }>
  /** A URL the <video> element can stream (range requests) — throws VideoUnavailableError if there is no stored file. */
  getVideoUrl(asset: Pick<VideoAsset, 'id' | 'storage_path'>): Promise<string>
  /** Deletes the asset row (RLS-checked) and its stored object. */
  deleteVideo(asset: Pick<VideoAsset, 'id' | 'storage_path'>): Promise<void>
  videoExists(asset: Pick<VideoAsset, 'id' | 'storage_path'>): Promise<StoredObjectInfo>
}

export class VideoUnavailableError extends Error {
  readonly reason: 'not_uploaded' | 'object_missing'
  constructor(reason: 'not_uploaded' | 'object_missing', message: string) {
    super(message)
    this.reason = reason
  }
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

// -----------------------------------------------------------------------------------------------
// Supabase Storage (legacy)
// -----------------------------------------------------------------------------------------------
const SUPABASE_BUCKET = 'videos'
const TUS_CHUNK_SIZE = 6 * 1024 * 1024 // required by Supabase resumable uploads

const supabaseProvider: VideoStorageProvider = {
  id: 'supabase',
  label: 'Supabase',

  async uploadVideo(file, videoId, hooks) {
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4'
    const storagePath = `${videoId}/original.${ext}`
    const contentType = file.type || 'video/mp4'
    if (supabaseConfig.isMock) {
      const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(storagePath, file, { upsert: false, contentType })
      if (error) throw error
      return { storagePath }
    }
    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: `${supabaseConfig.url}/storage/v1/upload/resumable`,
        chunkSize: TUS_CHUNK_SIZE,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        headers: { apikey: supabaseConfig.anonKey, 'x-upsert': 'false' },
        metadata: { bucketName: SUPABASE_BUCKET, objectName: storagePath, contentType, cacheControl: '3600' },
        onBeforeRequest: async (req) => {
          const { data, error } = await supabase.auth.getSession()
          if (error || !data.session) throw new Error(`Not authenticated for upload: ${error?.message ?? 'no active session'}`)
          req.setHeader('authorization', `Bearer ${data.session.access_token}`)
        },
        onProgress: (sent, total) => hooks.onProgress({ bytesSent: sent, bytesStored: Math.min(sent, total), bytesTotal: total }),
        onChunkComplete: (_c, accepted, total) => hooks.onProgress({ bytesSent: accepted, bytesStored: accepted, bytesTotal: total }),
        onError: (error) => {
          if (error instanceof tus.DetailedError && error.originalResponse) {
            const status = error.originalResponse.getStatus()
            let detail = error.originalResponse.getBody()
            try {
              const parsed = JSON.parse(detail) as { message?: string; error?: string }
              detail = parsed.message || parsed.error || detail
            } catch {
              // body is not JSON
            }
            reject(new Error(`HTTP ${status}: ${detail || error.message}${status === 413 ? ' — exceeds the Supabase Storage per-file limit' : ''}`))
          } else {
            reject(error)
          }
        },
        onSuccess: () => resolve(),
      })
      upload.start()
    })
    return { storagePath }
  },

  async getVideoUrl(asset) {
    if (!asset.storage_path) throw new VideoUnavailableError('not_uploaded', 'This video has no stored file.')
    const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(asset.storage_path)
    if (!data?.publicUrl) throw new VideoUnavailableError('object_missing', 'Could not resolve the stored file URL.')
    return data.publicUrl
  },

  async deleteVideo(asset) {
    const { data, error } = await supabase.from('video_assets').delete().eq('id', asset.id).select('id')
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) throw new Error('not permitted (only the uploader or a Supervisor/Admin can delete)')
    if (asset.storage_path) {
      const { error: storageErr } = await supabase.storage.from(SUPABASE_BUCKET).remove([asset.storage_path])
      if (storageErr) console.warn('Video file removal failed:', storageErr)
    }
  },

  async videoExists(asset) {
    if (!asset.storage_path) return { exists: false, size: null }
    const { data, error } = await supabase.rpc('video_asset_storage_info')
    if (error) throw error
    const row = (Array.isArray(data) ? data : []).find((r: { video_id: string }) => r.video_id === asset.id) as
      { object_exists: boolean | null; object_size: number | null } | undefined
    return { exists: !!row?.object_exists, size: row?.object_size ?? null }
  },
}

// -----------------------------------------------------------------------------------------------
// Backblaze B2 (via the video-storage Edge Function)
// -----------------------------------------------------------------------------------------------
const B2_PART_CONCURRENCY = 3
const B2_PART_ATTEMPTS = 6
const B2_SIGN_BATCH = 20

async function callVideoStorage<T>(body: Record<string, unknown>): Promise<T> {
  if (supabaseConfig.isMock || !supabase.functions) throw new Error('B2 video storage is unavailable in demo mode (no Supabase project configured)')
  const { data, error } = await supabase.functions.invoke('video-storage', { body })
  if (error) {
    let message = errorText(error)
    const context: unknown = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { error?: string }
        if (payload.error) message = payload.error
      } catch {
        // non-JSON error body
      }
    }
    throw new Error(`video-storage ${String(body.action)}: ${message}`)
  }
  return data as T
}

interface PartResult { partNumber: number; etag: string }

/** PUT one part to its presigned URL, reporting real bytes sent. Resolves with the part's ETag. */
function putPart(url: string, blob: Blob, onBytes: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onBytes(e.loaded) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag')
        if (!etag) {
          reject(new Error('B2 accepted the part but the ETag header is not readable — the bucket CORS rules must expose "ETag"'))
          return
        }
        resolve(etag)
      } else {
        const code = xhr.responseText.match(/<Code>([^<]*)<\/Code>/)?.[1]
        const msg = xhr.responseText.match(/<Message>([^<]*)<\/Message>/)?.[1]
        reject(Object.assign(new Error(`HTTP ${xhr.status}${code ? ` ${code}` : ''}${msg ? `: ${msg}` : ''}`), { status: xhr.status }))
      }
    }
    xhr.onerror = () => reject(Object.assign(new Error('Network error (connection dropped or blocked by CORS)'), { status: 0 }))
    xhr.ontimeout = () => reject(Object.assign(new Error('Part upload timed out'), { status: 0 }))
    xhr.send(blob)
  })
}

const b2Provider: VideoStorageProvider = {
  id: 'b2',
  label: 'B2',

  async uploadVideo(file, videoId, hooks) {
    const init = await callVideoStorage<{ uploadId: string; key: string; partSize: number; partCount: number }>({
      action: 'create-upload', videoId, fileName: file.name, fileSize: file.size, contentType: file.type || 'video/mp4'
    })
    hooks.onLog(`B2 multipart upload created: ${init.partCount} part(s) of ${(init.partSize / (1024 * 1024)).toFixed(0)} MB → ${init.key}`)

    const sentPerPart = new Map<number, number>()
    let stored = 0
    const report = () => {
      let sent = stored
      sentPerPart.forEach(v => { sent += v })
      hooks.onProgress({ bytesSent: Math.min(sent, file.size), bytesStored: stored, bytesTotal: file.size })
    }

    const urlCache = new Map<number, string>()
    const signParts = async (from: number) => {
      const numbers: number[] = []
      for (let n = from; n <= init.partCount && numbers.length < B2_SIGN_BATCH; n++) if (!urlCache.has(n)) numbers.push(n)
      if (numbers.length === 0) return
      const signed = await callVideoStorage<{ urls: Record<string, string> }>({ action: 'sign-parts', videoId, uploadId: init.uploadId, partNumbers: numbers })
      for (const [n, url] of Object.entries(signed.urls)) urlCache.set(Number(n), url)
    }

    const results: PartResult[] = []
    let nextPart = 1
    const state: { failure: Error | null } = { failure: null }

    const uploadOne = async (partNumber: number) => {
      const start = (partNumber - 1) * init.partSize
      const blob = file.slice(start, Math.min(start + init.partSize, file.size)) // no full-file read
      for (let attempt = 1; attempt <= B2_PART_ATTEMPTS; attempt++) {
        if (state.failure) return
        try {
          if (!urlCache.has(partNumber)) await signParts(partNumber)
          const url = urlCache.get(partNumber)
          if (!url) throw new Error(`No signed URL for part ${partNumber}`)
          const etag = await putPart(url, blob, loaded => { sentPerPart.set(partNumber, loaded); report() })
          sentPerPart.delete(partNumber)
          stored += blob.size
          results.push({ partNumber, etag })
          report()
          return
        } catch (e) {
          sentPerPart.delete(partNumber)
          report()
          const status = (e as { status?: number }).status
          if (status === 403) urlCache.delete(partNumber) // expired/invalid signature: re-sign
          if (attempt === B2_PART_ATTEMPTS) throw new Error(`Part ${partNumber}/${init.partCount} failed after ${attempt} attempts: ${errorText(e)}`)
          const delay = Math.min(30000, 1000 * 2 ** (attempt - 1))
          hooks.onLog(`Part ${partNumber}/${init.partCount} failed (${errorText(e)}); retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${B2_PART_ATTEMPTS})`)
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }

    const worker = async () => {
      while (!state.failure && nextPart <= init.partCount) {
        const partNumber = nextPart++
        try {
          await uploadOne(partNumber)
        } catch (e) {
          state.failure = e instanceof Error ? e : new Error(errorText(e))
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(B2_PART_CONCURRENCY, init.partCount) }, worker))

    if (state.failure) {
      await callVideoStorage({ action: 'abort-upload', videoId, uploadId: init.uploadId })
        .catch(e => hooks.onLog(`Could not abort the B2 multipart upload: ${errorText(e)}`))
      throw state.failure
    }

    const done = await callVideoStorage<{ storagePath: string; size: number }>({
      action: 'complete-upload', videoId, uploadId: init.uploadId, parts: results
    })
    return { storagePath: done.storagePath }
  },

  async getVideoUrl(asset) {
    if (!asset.storage_path) throw new VideoUnavailableError('not_uploaded', 'This video has no stored file.')
    const res = await callVideoStorage<{ exists: boolean; url?: string; reason?: string }>({ action: 'playback-url', videoId: asset.id })
    if (!res.exists || !res.url) {
      throw new VideoUnavailableError(
        res.reason === 'not_uploaded' ? 'not_uploaded' : 'object_missing',
        res.reason === 'not_uploaded' ? 'This video has no stored file.' : 'The stored file for this video no longer exists in B2.'
      )
    }
    return res.url
  },

  async deleteVideo(asset) {
    const res = await callVideoStorage<{ deleted: boolean; warnings?: string[] }>({ action: 'delete-video', videoId: asset.id })
    if (res.warnings && res.warnings.length > 0) console.warn('B2 object cleanup warnings:', res.warnings)
  },

  async videoExists(asset) {
    return callVideoStorage<StoredObjectInfo>({ action: 'object-info', videoId: asset.id })
  },
}

const providers: Record<StorageProviderId, VideoStorageProvider> = { supabase: supabaseProvider, b2: b2Provider }

/** Provider holding an existing asset's bytes. */
export function storageProviderFor(asset: { storage_provider?: string | null }): VideoStorageProvider {
  return asset.storage_provider === 'b2' ? b2Provider : supabaseProvider
}

/** Provider for new uploads (non-secret client config; defaults to B2). */
export function uploadStorageProvider(): VideoStorageProvider {
  const configured = import.meta.env.VITE_VIDEO_STORAGE_PROVIDER
  return configured === 'supabase' ? providers.supabase : providers.b2
}
