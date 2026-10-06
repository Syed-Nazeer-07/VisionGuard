// video-storage: the only component that holds Backblaze B2 credentials.
//
// The browser never sees B2 keys. It calls this function (with its Supabase JWT) and receives
// short-lived presigned URLs for exactly one object:
//   - multipart upload parts (PUT, direct browser → B2, real byte progress, per-part retry)
//   - playback (GET, supports HTTP range requests for play/seek)
// Every action reads video_assets through a client bound to the caller's JWT, so Supabase RLS
// decides which assets the caller may see / delete. Upload actions additionally require that the
// caller is the asset's uploader.
//
// Required secrets (supabase secrets set ...):
//   B2_ENDPOINT          e.g. https://s3.us-west-004.backblazeb2.com
//   B2_REGION            e.g. us-west-004
//   B2_BUCKET            private bucket name
//   B2_KEY_ID            application key id (restricted to the bucket)
//   B2_APPLICATION_KEY   application key
// SUPABASE_URL / SUPABASE_ANON_KEY are provided by the Edge runtime.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PART_URL_TTL_SECONDS = 60 * 60 // 1 h per signed part URL (re-signed on demand)
const PLAYBACK_URL_TTL_SECONDS = 6 * 60 * 60 // 6 h
const MIN_PART_SIZE = 10 * 1024 * 1024 // B2/S3 minimum is 5 MiB; 10 MiB keeps retries cheap on slow links
const MAX_PARTS = 10_000
const MAX_FILE_SIZE = 50 * 1024 * 1024 * 1024 // 50 GiB application ceiling

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

interface B2Config {
  endpoint: string
  bucket: string
  aws: AwsClient
}

function b2Config(): B2Config {
  const endpoint = (Deno.env.get('B2_ENDPOINT') ?? '').replace(/\/+$/, '')
  const region = Deno.env.get('B2_REGION') ?? ''
  const bucket = Deno.env.get('B2_BUCKET') ?? ''
  const keyId = Deno.env.get('B2_KEY_ID') ?? ''
  const appKey = Deno.env.get('B2_APPLICATION_KEY') ?? ''
  const missing = Object.entries({ B2_ENDPOINT: endpoint, B2_REGION: region, B2_BUCKET: bucket, B2_KEY_ID: keyId, B2_APPLICATION_KEY: appKey })
    .filter(([, v]) => !v).map(([k]) => k)
  if (missing.length > 0) throw new HttpError(503, `Video storage is not configured on the server (missing: ${missing.join(', ')})`)
  return {
    endpoint,
    bucket,
    aws: new AwsClient({ accessKeyId: keyId, secretAccessKey: appKey, service: 's3', region }),
  }
}

function objectUrl(cfg: B2Config, key: string): URL {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  return new URL(`${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}/${encodedKey}`)
}

function xmlValue(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return m ? m[1] : null
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function s3(cfg: B2Config, method: string, url: URL, init: { body?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const res = await cfg.aws.fetch(url.toString(), { method, body: init.body, headers: init.headers })
  if (!res.ok && res.status !== 404) {
    const text = await res.text()
    throw new HttpError(502, `B2 ${method} failed (HTTP ${res.status}): ${xmlValue(text, 'Message') ?? xmlValue(text, 'Code') ?? text.slice(0, 200)}`)
  }
  return res
}

async function presign(cfg: B2Config, method: 'GET' | 'PUT', url: URL, ttlSeconds: number): Promise<string> {
  url.searchParams.set('X-Amz-Expires', String(ttlSeconds))
  const signed = await cfg.aws.sign(url.toString(), { method, aws: { signQuery: true } })
  return signed.url
}

function partSizeFor(fileSize: number): number {
  const needed = Math.ceil(fileSize / MAX_PARTS)
  return Math.max(MIN_PART_SIZE, Math.ceil(needed / (1024 * 1024)) * 1024 * 1024)
}

function extensionOf(fileName: string): string {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return ext && ext.length <= 8 ? ext : 'mp4'
}

interface AssetRow {
  id: string
  uploaded_by: string | null
  storage_provider: string
  storage_path: string
  file_size: number | null
  metadata: Record<string, unknown> | null
}

async function loadAsset(db: SupabaseClient, videoId: string): Promise<AssetRow> {
  if (typeof videoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(videoId)) throw new HttpError(400, 'Invalid videoId')
  const { data, error } = await db
    .from('video_assets')
    .select('id, uploaded_by, storage_provider, storage_path, file_size, metadata')
    .eq('id', videoId)
    .maybeSingle()
  if (error) throw new HttpError(500, `video_assets lookup failed: ${error.message}`)
  if (!data) throw new HttpError(404, `Video asset ${videoId} not found or not accessible`)
  return data as AssetRow
}

function requireUploader(asset: AssetRow, userId: string) {
  if (asset.storage_provider !== 'b2') throw new HttpError(409, `Video asset ${asset.id} is not stored in B2`)
  if (asset.uploaded_by !== userId) throw new HttpError(403, 'Only the uploader can upload this video')
}

function requireUploadId(asset: AssetRow, uploadId: unknown): string {
  const meta = asset.metadata ?? {}
  if (typeof uploadId !== 'string' || !uploadId || meta.b2_upload_id !== uploadId || typeof meta.b2_object_key !== 'string') {
    throw new HttpError(409, 'Upload session does not match this video asset')
  }
  return meta.b2_object_key
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = req.headers.get('Authorization')
    if (!authorization) throw new HttpError(401, 'Missing Authorization header')
    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userErr } = await db.auth.getUser()
    if (userErr || !userData.user) throw new HttpError(401, 'Not authenticated')
    const userId = userData.user.id

    const body = await req.json() as Record<string, unknown>
    const action = body.action
    const videoId = String(body.videoId ?? '')

    switch (action) {
      case 'create-upload': {
        const asset = await loadAsset(db, videoId)
        requireUploader(asset, userId)
        if (asset.storage_path) throw new HttpError(409, 'This video asset already has a stored file')
        const fileSize = Number(body.fileSize)
        if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE) throw new HttpError(400, 'Invalid fileSize')
        if (asset.file_size !== null && Number(asset.file_size) !== fileSize) throw new HttpError(409, 'fileSize does not match the video asset record')
        const contentType = typeof body.contentType === 'string' && body.contentType.startsWith('video/') ? body.contentType : 'video/mp4'

        const cfg = b2Config()
        // One object per asset, keyed by the canonical video_id: uploads can never collide or overwrite.
        const key = `videos/${asset.id}/original.${extensionOf(String(body.fileName ?? ''))}`
        const url = objectUrl(cfg, key)
        url.searchParams.set('uploads', '')
        const res = await s3(cfg, 'POST', url, { headers: { 'Content-Type': contentType } })
        const uploadId = xmlValue(await res.text(), 'UploadId')
        if (!uploadId) throw new HttpError(502, 'B2 did not return an UploadId')

        const partSize = partSizeFor(fileSize)
        const { error: metaErr } = await db
          .from('video_assets')
          .update({ metadata: { ...(asset.metadata ?? {}), b2_upload_id: uploadId, b2_object_key: key } })
          .eq('id', asset.id)
        if (metaErr) throw new HttpError(500, `Could not record upload session: ${metaErr.message}`)
        return json({ uploadId, key, partSize, partCount: Math.ceil(fileSize / partSize) })
      }

      case 'sign-parts': {
        const asset = await loadAsset(db, videoId)
        requireUploader(asset, userId)
        const key = requireUploadId(asset, body.uploadId)
        const partNumbers = Array.isArray(body.partNumbers) ? body.partNumbers.map(Number) : []
        if (partNumbers.length === 0 || partNumbers.length > 100 || partNumbers.some(n => !Number.isInteger(n) || n < 1 || n > MAX_PARTS)) {
          throw new HttpError(400, 'partNumbers must be 1–100 integers between 1 and 10000')
        }
        const cfg = b2Config()
        const urls: Record<string, string> = {}
        for (const n of partNumbers) {
          const url = objectUrl(cfg, key)
          url.searchParams.set('partNumber', String(n))
          url.searchParams.set('uploadId', String(body.uploadId))
          urls[String(n)] = await presign(cfg, 'PUT', url, PART_URL_TTL_SECONDS)
        }
        return json({ urls, expiresIn: PART_URL_TTL_SECONDS })
      }

      case 'complete-upload': {
        const asset = await loadAsset(db, videoId)
        requireUploader(asset, userId)
        const key = requireUploadId(asset, body.uploadId)
        const parts = Array.isArray(body.parts) ? body.parts as Array<{ partNumber: unknown; etag: unknown }> : []
        if (parts.length === 0) throw new HttpError(400, 'No parts supplied')
        const sorted = parts
          .map(p => ({ partNumber: Number(p.partNumber), etag: String(p.etag ?? '') }))
          .sort((a, b) => a.partNumber - b.partNumber)
        if (sorted.some((p, i) => p.partNumber !== i + 1 || !p.etag)) throw new HttpError(400, 'Parts must be numbered 1..N, each with an ETag')

        const cfg = b2Config()
        const url = objectUrl(cfg, key)
        url.searchParams.set('uploadId', String(body.uploadId))
        const xml = `<CompleteMultipartUpload>${sorted.map(p => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
        const res = await s3(cfg, 'POST', url, { body: xml, headers: { 'Content-Type': 'application/xml' } })
        const text = await res.text()
        if (res.status === 404 || text.includes('<Error>')) {
          throw new HttpError(502, `B2 could not complete the upload: ${xmlValue(text, 'Message') ?? xmlValue(text, 'Code') ?? `HTTP ${res.status}`}`)
        }

        // Verify the stored object before anyone records it as uploaded.
        const head = await s3(cfg, 'HEAD', objectUrl(cfg, key))
        if (head.status === 404) throw new HttpError(502, 'Upload completed but the object is not visible in B2')
        const size = Number(head.headers.get('Content-Length') ?? '0')
        if (asset.file_size !== null && size !== Number(asset.file_size)) {
          throw new HttpError(502, `Stored object size ${size} does not match the uploaded file size ${asset.file_size}`)
        }
        return json({ storagePath: key, size })
      }

      case 'abort-upload': {
        const asset = await loadAsset(db, videoId)
        requireUploader(asset, userId)
        const key = requireUploadId(asset, body.uploadId)
        const cfg = b2Config()
        const url = objectUrl(cfg, key)
        url.searchParams.set('uploadId', String(body.uploadId))
        await s3(cfg, 'DELETE', url)
        return json({ aborted: true })
      }

      case 'playback-url': {
        const asset = await loadAsset(db, videoId) // RLS: caller must be able to read the asset
        if (asset.storage_provider !== 'b2') throw new HttpError(409, `Video asset ${asset.id} is not stored in B2`)
        if (!asset.storage_path) return json({ exists: false, reason: 'not_uploaded' })
        const cfg = b2Config()
        const head = await s3(cfg, 'HEAD', objectUrl(cfg, asset.storage_path))
        if (head.status === 404) return json({ exists: false, reason: 'object_missing' })
        const url = await presign(cfg, 'GET', objectUrl(cfg, asset.storage_path), PLAYBACK_URL_TTL_SECONDS)
        return json({
          exists: true,
          url,
          size: Number(head.headers.get('Content-Length') ?? '0'),
          expiresAt: new Date(Date.now() + PLAYBACK_URL_TTL_SECONDS * 1000).toISOString(),
        })
      }

      case 'object-info': {
        const asset = await loadAsset(db, videoId)
        if (asset.storage_provider !== 'b2' || !asset.storage_path) return json({ exists: false, size: null })
        const cfg = b2Config()
        const head = await s3(cfg, 'HEAD', objectUrl(cfg, asset.storage_path))
        return json(head.status === 404 ? { exists: false, size: null } : { exists: true, size: Number(head.headers.get('Content-Length') ?? '0') })
      }

      case 'delete-video': {
        const asset = await loadAsset(db, videoId)
        // RLS decides: only the uploader or a Supervisor/Admin can delete the row.
        const { data: deleted, error: delErr } = await db.from('video_assets').delete().eq('id', asset.id).select('id')
        if (delErr) throw new HttpError(500, `Delete failed: ${delErr.message}`)
        if (!deleted || deleted.length === 0) throw new HttpError(403, 'Not permitted to delete this video (only the uploader or a Supervisor/Admin can)')

        if (asset.storage_provider !== 'b2') return json({ deleted: true, objectsRemoved: 0 })
        const cfg = b2Config()
        const meta = asset.metadata ?? {}
        let removed = 0
        const warnings: string[] = []
        // Unfinished multipart upload: abort it so its parts stop consuming storage.
        if (!asset.storage_path && typeof meta.b2_upload_id === 'string' && typeof meta.b2_object_key === 'string') {
          const url = objectUrl(cfg, meta.b2_object_key)
          url.searchParams.set('uploadId', meta.b2_upload_id)
          await s3(cfg, 'DELETE', url).catch(e => warnings.push(String(e instanceof Error ? e.message : e)))
        }
        // Remove every stored version (B2 buckets keep versions; a plain DELETE only hides the file).
        const key = asset.storage_path || (typeof meta.b2_object_key === 'string' ? meta.b2_object_key : '')
        if (key) {
          const listUrl = new URL(`${cfg.endpoint}/${encodeURIComponent(cfg.bucket)}`)
          listUrl.searchParams.set('versions', '')
          listUrl.searchParams.set('prefix', key)
          const listing = await (await s3(cfg, 'GET', listUrl)).text()
          const versions = [...listing.matchAll(/<(?:Version|DeleteMarker)>([\s\S]*?)<\/(?:Version|DeleteMarker)>/g)]
            .map(m => ({ key: xmlValue(m[1], 'Key'), versionId: xmlValue(m[1], 'VersionId') }))
            .filter(v => v.key === key && v.versionId)
          for (const v of versions) {
            const url = objectUrl(cfg, key)
            url.searchParams.set('versionId', v.versionId!)
            try {
              await s3(cfg, 'DELETE', url)
              removed++
            } catch (e) {
              warnings.push(String(e instanceof Error ? e.message : e))
            }
          }
        }
        return json({ deleted: true, objectsRemoved: removed, warnings })
      }

      default:
        throw new HttpError(400, `Unknown action: ${String(action)}`)
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    const message = e instanceof Error ? e.message : String(e)
    if (status >= 500) console.error('video-storage error:', message)
    return json({ error: message }, status)
  }
})
