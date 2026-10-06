import { supabase } from './supabase'
import type { VideoAsset } from '../services/db'

export type UploadStatus = 'uploading' | 'uploaded' | 'failed'

/** Upload lifecycle is tracked in metadata.upload_status (processing_status is reserved for analysis). */
export function getUploadStatus(asset: Pick<VideoAsset, 'metadata' | 'storage_path'>): UploadStatus | null {
  const meta = asset.metadata
  const status = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta.upload_status : undefined
  if (status === 'uploading' || status === 'uploaded' || status === 'failed') return status
  return asset.storage_path ? 'uploaded' : null
}

/** Public URL of the canonical Storage copy, or null when the upload never completed. */
export function getStoredVideoUrl(asset: Pick<VideoAsset, 'storage_path'>): string | null {
  if (!asset.storage_path) return null
  const { data } = supabase.storage.from('videos').getPublicUrl(asset.storage_path)
  return data?.publicUrl || null
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
