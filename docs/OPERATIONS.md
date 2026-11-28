# Operations and privacy

This guide documents data handling, troubleshooting and known limits of the current browser-first architecture.

## Data and privacy

| Data | Stored where | Important behavior |
| --- | --- | --- |
| Vehicle tracks, session totals, review flags | Per-account browser IndexedDB; optional Supabase PostgreSQL sync | Local-first. Cloud writes verify server acknowledgments, retry bounded conflicting revisions and preserve merged local history if sync remains unavailable |
| Original selected file | In memory during analysis | Not kept across reloads by default |
| Opted-in local video | Browser IndexedDB (actual Blob) | **Keep this video on this device** retains an actual copy of the most recent original for that signed-in account (subject to browser quota). Edge file-picker permission is not required to reopen newly saved videos |
| Explicit cloud video | Backblaze B2 | Uploaded only via **Save video to B2** after server-side credentials are configured. An upload error leaves no playable cloud video; the UI offers an opt-in local retention alternative |
| Account credentials and preferences | Supabase Auth / PostgreSQL when configured | Protected by server-side access policies |

The active video/capture component resets when the signed-in account changes, keeping in-memory capture and tracker state from crossing between users.

### Recover an archived video without an uploaded original

If you select a video in the cloud archive but its B2 upload is missing,
**Live Analysis will no longer stop at a raw storage error**. It checks
the opted-in retained copy on the **same device and signed-in account**.
If the stored filename **and exact file size** match, it opens that local
video as a new analysis. This is a conservative recovery heuristic, **not
cryptographic identity verification**. The original remains local; the
recovery does not automatically upload it to B2.

Otherwise, VisionGuard shows **Choose original video**. Select your own
footage from the device to analyze it afresh. Previously saved detection
summaries remain available in History. A filename alone is not enough to
assume an unrelated retained video belongs to an archived session.

**Important:** analysis metadata cannot recreate the original footage.
If its cloud copy was never uploaded and the local original is gone, it
cannot be recovered from VisionGuard. For cross-device playback, explicitly
use **Save video to B2** and confirm the upload finishes.

### What if Backblaze B2 says storage is not configured?

If uploading displays `Video storage is not configured on the server`,
**the browser detector is still working**. The optional `video-storage`
Supabase Edge Function lacks its Backblaze B2 configuration. Do not
retry the same upload repeatedly or mistake a database video record for
the original footage. VisionGuard now explains the problem, hides a
misleading failed-upload progress bar and offers **Keep this original on
my device**. Local retention is explicitly opt-in, can be limited by
browser storage, and currently preserves **only the most recent original
per signed-in account on that device**. The saved video is now an actual
IndexedDB file copy instead of a browser File System Access shortcut.
Older versions that saved a file handle may require you to select the
original once more, because Edge can revoke previously granted access.

To enable cross-device video playback, the project owner must create
a B2 bucket and restricted application key, then configure the five
**server-side** Supabase Edge Function secrets required by
[`video-storage`](../supabase/functions/video-storage/index.ts):
`B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_KEY_ID` and
`B2_APPLICATION_KEY`. Set the correct bucket CORS permissions for
permitted browser GET/PUT/range requests. **Never** put these values in
`VITE_*`, browser localStorage, GitHub source or chat messages.
Cloudflare build variables alone cannot configure the Supabase function.

### Understanding the speed numbers

Image movement alone cannot reliably determine a vehicle's real road speed without appropriate camera geometry and calibration. VisionGuard's `km/h*` label is a **relative optical speed proxy** based on assumed vehicle widths and image movement, **not a calibrated road-speed measurement**; it can materially under- or over-estimate actual driving speed. The live card shows the highest available proxy among currently visible tracks, not a road speed limit or verified speeding event. Prediction-only boxes do not create new measurements.

**Never use VisionGuard's current speed estimates or review flags as legal enforcement evidence.** A flag marked **Reviewed** only records a user workflow decision; it does not establish a violation. Misclassification, occlusion, camera movement, lighting and dropped frames can also affect counts and tracking.

### Cross-device incident history

Review decisions retain their original incident evidence and include an
optional decision timestamp. VisionGuard now checks the **actual returned
Supabase revision** after each analysis-record upsert. If another signed-in
browser has newer history, the app merges distinct incident flags and vehicle
observations, keeps the newer explicitly timestamped review decision, and
retries synchronization up to three times. Failed sync remains **local and
visible as a warning** rather than being marked as a successful backup.

Continuous inference updates arriving while a previous cloud write is in
flight are now queued for the next upload rather than misreported as a
three-attempt conflict. A scheduled upload also covers the final revision
when a video stops during the cloud throttle interval.

This is *best-effort owner-scoped metadata synchronization*, **not**
transactional multi-user collaboration. Simultaneous decisions from
devices with incorrect clocks, separate offline edits to the same tracking
fields, and network failures can still require manual verification. Testing
on two signed-in devices is part of the release checklist. RLS and the
database's existing anti-stale-update trigger remain unchanged.

See also [live analysis](LIVE_ANALYSIS.md), [deployment](CLOUDFLARE_PAGES.md) and [release acceptance](RELEASE_CHECKLIST.md).
