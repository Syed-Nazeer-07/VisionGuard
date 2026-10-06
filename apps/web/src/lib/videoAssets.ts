import { supabase } from './supabase'
import type { VideoAsset } from '../services/db'
import type { Json } from '../types/supabase'
import { storageProviderFor } from '../services/videoStorage'

export type UploadStatus = 'uploading' | 'uploaded' | 'failed'

/** Upload lifecycle is tracked in metadata.upload_status (processing_status is reserved for analysis). */
export function getUploadStatus(asset: Pick<VideoAsset, 'metadata' | 'storage_path'>): UploadStatus | null {
  const meta = asset.metadata
  const status = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta.upload_status : undefined
  if (status === 'uploading' || status === 'uploaded' || status === 'failed') return status
  return asset.storage_path ? 'uploaded' : null
}

/**
 * Streamable URL for this asset's own stored file, resolved by the provider recorded on the row
 * (B2: short-lived presigned URL from the video-storage Edge Function). Throws VideoUnavailableError
 * when the asset has no stored file — it never substitutes another video.
 */
export function resolveVideoUrl(asset: Pick<VideoAsset, 'id' | 'storage_path' | 'storage_provider'>): Promise<string> {
  return storageProviderFor(asset).getVideoUrl(asset)
}

export function storageProviderLabel(asset: Pick<VideoAsset, 'storage_provider'>): string {
  return storageProviderFor(asset).label
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(i >= 3 ? 2 : 1))} ${units[i]}`
}

export interface StorageInfo {
  /** null = not checkable in the database (B2 objects are verified by the Edge Function on playback). */
  objectExists: boolean | null
  objectSize: number | null
  /** Earlier asset whose stored file is byte-identical (same size + MD5 eTag), if any. */
  identicalToVideoId: string | null
}

interface StorageInfoRow {
  video_id: string
  object_exists: boolean | null
  object_size: number | null
  identical_to_video_id: string | null
}

/** Storage object state for every asset (public.video_asset_storage_info). */
export async function fetchStorageInfo(): Promise<Map<string, StorageInfo>> {
  const { data, error } = await supabase.rpc('video_asset_storage_info')
  if (error) throw error
  const rows = (Array.isArray(data) ? data : []) as StorageInfoRow[]
  return new Map(rows.map(r => [r.video_id, {
    objectExists: r.object_exists,
    objectSize: r.object_size === null ? null : Number(r.object_size),
    identicalToVideoId: r.identical_to_video_id
  }]))
}

export type AssetAvailability =
  | { kind: 'available' }
  | { kind: 'uploading' }
  | { kind: 'upload_failed'; detail: string }
  | { kind: 'upload_incomplete' }
  | { kind: 'file_missing' }

/**
 * Whether the asset's own stored file can be played. `uploadingHere` is true when this tab's
 * uploadManager is still transferring the file. Never substitutes another asset's file.
 */
export function getAssetAvailability(
  asset: Pick<VideoAsset, 'storage_path' | 'metadata'>,
  info: StorageInfo | undefined,
  uploadingHere: boolean
): AssetAvailability {
  if (uploadingHere) return { kind: 'uploading' }
  const meta: { [key: string]: Json | undefined } = asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata) ? asset.metadata : {}
  const status = getUploadStatus(asset)
  if (status === 'failed') return { kind: 'upload_failed', detail: typeof meta.upload_error === 'string' ? meta.upload_error : 'unknown error' }
  if (!asset.storage_path) return { kind: 'upload_incomplete' }
  if (info && info.objectExists === false) return { kind: 'file_missing' }
  return { kind: 'available' }
}

export function availabilityMessage(a: AssetAvailability): string | null {
  switch (a.kind) {
    case 'available': return null
    case 'uploading': return 'Upload in progress.'
    case 'upload_failed': return `The upload of this video failed: ${a.detail}. Upload the file again.`
    case 'upload_incomplete': return 'This video was never fully uploaded (the transfer stopped before finishing, e.g. the page was closed or reloaded). No stored copy exists — upload the file again.'
    case 'file_missing': return 'The stored file for this video no longer exists in Storage.'
  }
}

/**
 * "Video N" from the database-assigned display_number. If that column is not available yet,
 * numbering falls back to upload order within the provided list (oldest = Video 1).
 */
export function videoDisplayName(asset: Pick<VideoAsset, 'id' | 'display_number' | 'filename'>, fallbackNumbers?: Map<string, number>): string {
  if (typeof asset.display_number === 'number') return `Video ${asset.display_number}`
  const n = fallbackNumbers?.get(asset.id)
  return n ? `Video ${n}` : asset.filename
}

export function fallbackVideoNumbers(assets: Pick<VideoAsset, 'id' | 'uploaded_at'>[]): Map<string, number> {
  const ordered = [...assets].sort((a, b) =>
    (Date.parse(a.uploaded_at ?? '') || 0) - (Date.parse(b.uploaded_at ?? '') || 0) || a.id.localeCompare(b.id))
  return new Map(ordered.map((a, i) => [a.id, i + 1]))
}
