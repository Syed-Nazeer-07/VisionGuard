# Backblaze B2 restoration — VisionGuard staging

**Separation of responsibilities:** Supabase remains Auth + PostgreSQL
database for users, camera metadata, analysis runs, tracking and incidents.
**Backblaze B2 is the private object store for uploaded video bytes.**
Do not try to replace the application's SQL database with B2 (object storage
is not a relational database).

## What is already in place

- Staging Supabase project `wpkwxlhwjkgtvyersust`.
- JWT-verified Edge Function `video-storage` **deployed and ACTIVE** (v2, with artifact actions).
- Video browser client supports B2 multipart upload, retry, resumable
  presigned part URLs, short-lived playback URLs and deletion.
- This recovery branch restores `VITE_VIDEO_STORAGE_PROVIDER=b2` as the
  staging template default. Existing video assets continue using their
  recorded `storage_provider`.
- **B2 account/bucket secrets have not been configured.** Deployment is not
  proof of an operational B2 connection.

## Configure B2 securely (never commit credentials)

In Backblaze, create or select a **private** B2 bucket, enable S3-compatible
API access, and create an **application key restricted to that bucket** with
the operations needed for multipart PUT/list/delete/get. Note the region,
S3 endpoint, bucket name, key ID and application key.

Use the Supabase Dashboard → Project Settings → Edge Functions → Secrets for
the **staging project only** or the Supabase CLI's secrets command to set:

| Secret | Value |
|---|---|
| `B2_ENDPOINT` | B2 **S3** endpoint, e.g. `https://s3.us-west-004.backblazeb2.com` |
| `B2_REGION` | Region from endpoint, e.g. `us-west-004` |
| `B2_BUCKET` | Private B2 bucket name |
| `B2_KEY_ID` | Restricted B2 application key ID |
| `B2_APPLICATION_KEY` | Restricted B2 application key secret |

**Never put these in the repository, frontend `.env`, `VITE_*`
variables, browser console or ChatGPT.** The server-side Edge Function
reads them at request time, and signed URLs authorize restricted operations.

Confirm bucket CORS for `http://localhost:3000` and your eventual
app origin. The recommended rules are in
`supabase/functions/video-storage/b2-bucket-cors.json`. For multipart
uploads ensure allowed S3 operations, headers, and **expose `ETag`**;
missing ETag causes the browser to reject otherwise uploaded parts.
Restrict origins in production.

In the project's root `.env`:

```env
VITE_SUPABASE_URL=https://wpkwxlhwjkgtvyersust.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_BROWSER_PUBLISHABLE_KEY
VITE_VIDEO_STORAGE_PROVIDER=b2
```

Restart `npm run dev`. Do not set a secret/service-role key as the
frontend API key. A publishable key is public; authorization is enforced by
the signed-in user's JWT and RLS policies.

## Acceptance tests (not yet passed)

1. Sign in to staging as an authorized Viewer.
2. Upload a **short, non-sensitive** MP4 through VisionGuard with Save to
   History enabled. The uploader should show B2, multipart progress and a
   successfully stored object; DB row should record `storage_provider='b2'`.
3. Reload page. Play and seek the B2 video using a fresh presigned URL.
   Confirm byte-range requests work and direct B2 bucket listing is private.
4. Sign in as another Viewer: no video asset row / playback URL for the
   owner's footage. Verify staff review permissions independently.
5. Simulate expired multipart part signature and retry; confirm failed
   uploads abort outstanding parts and record errors clearly.
6. Run a saved Python analysis after configuring the optional backend.
   Verify the gzip run artifact is stored in B2 under
   `artifacts/{videoId}/{runId}.json.gz` (bucket marker `b2-artifacts`)
   and is still readable after reloading Video Review.
7. Confirm no new source video **or analysis artifact** is stored in the
   Supabase `videos` Storage bucket. Existing historical artifacts there
   remain readable for compatibility.
8. Delete a test video and verify B2 **old versions and run artifacts**
   have been removed rather than merely hidden by delete markers.

## Troubleshooting

- **HTTP 503 / B2 secrets missing:** configure the five server-side
  variables above. The deployed function alone is insufficient.
- **HTTP 401:** browser key/session/JWT issue; never substitute a
  `sb_secret_` service key in the browser.
- **HTTP 403:** video ownership/RLS or B2 permissions; confirm the
  restricted application key's bucket scope.
- **CORS / missing ETag:** inspect the bucket's S3 CORS policy.
- **Supabase Storage quota:** do not select the Supabase video provider;
  choose B2 for new footage. New compressed analysis artifacts now also use B2;
  old artifacts are read from Supabase Storage only when explicitly referenced.
- **Local backend:** independent FastAPI application; browser YOLO does not
  require Python. On Windows on ARM, use the browser engine while native
  Python ML support is validated.

B2 upload quality and actual video availability are still unverified
until the above browser tests succeed.
