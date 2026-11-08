# VisionGuard v1 — release acceptance checklist

The core v1 application may pass CI without being ready for a public
production deployment. Verify these items on the **deployed HTTPS site**
and on the target Windows/Edge computer before promoting the release.

| Test | Pass condition |
| --- | --- |
| Landing, login, signup | Proper styling, mobile layout, no mock telemetry |
| Email confirmation | Account receives mail, opens valid redirect, signs in |
| Password recovery | Expired links show a recovery path; valid links update password |
| Google OAuth | Configured provider redirects successfully on local and deployed URLs |
| Roles | New signup is Viewer; non-admin cannot update roles or access Admin routes |
| Local video | Playback starts and tracking boxes follow road users |
| Fullscreen | Fullscreen player includes video **and** overlay; Escape exits |
| Scene exits | Boxes disappear promptly; quantify lingering frames after annotated exits using [browser QA](BROWSER_TRACKING_EVALUATION.md) |
| YouTube tab | No URL form; select **Analyze tab** and approve an existing YouTube tab; capture survives focus changes |
| Tab stalls and resumes | Muted, paused, frozen captures hide stale boxes; old optical IDs and incident streaks reset across long gaps; detection reacquires live vehicles |
| Extended live capture | At least 30 minutes on Edge/Chrome without growing GPU memory or leaking browser capture permission; verify actual decoded frames and CPU/GPU usage |
| Capture privacy | Global Stop button ends sharing; webcam releases on page hide |
| Live session history | Tracks persist across dashboard, history, analytics and reports |
| Review flags | Sustained high-speed estimates and stopped vehicles amid moving traffic automatically create review candidates, alongside manual flags; confirm they appear in Incidents and report exports |
| Incident decisions | Mark automatic/manual flags **Reviewed**, **Dismissed**, and **Reopen**. Refresh and verify preserved evidence, IDs, status filter totals and monotonic history revisions |
| Review export consistency | PDF and incident CSV display human-readable statuses, including dismissed items; reviewed never means confirmed traffic enforcement |
| Cross-device metadata | Sign in to two browsers and test concurrent incident decisions; verify stale upserts return old DB revisions, conflicting flags are reconciled and retried, missing acknowledgments surface warnings, and local evidence remains intact |
| Cloud recovery | Simulate offline work and return online; verify unacknowledged data stays in IndexedDB, genuine conflict retries are bounded, and Supabase RLS still restricts accounts |
| Continuous cloud sync | Run inference while a cloud upsert is pending; new frames must NOT cause false conflict exhaustion. Stop playback during the 15-second cloud throttle and verify the last local revision eventually uploads |
| Fast repeated updates | Create incident decisions and optical observations within the same millisecond; revisions stay monotonically increasing so the anti-stale trigger cannot silently discard changes |
| Reload persistence | Saved session data survives reload without duplicating IDs |
| Local video opt-in | Unchecked means original bytes are not retained across reloads |
| Optional local retention | Checked writes an actual file Blob to IndexedDB (browser quota applies), scoped to the signed-in account. Legacy Edge file handles with revoked permissions show a reselect explanation; newly saved copies reopen without file-picker permission |
| B2 storage | With credentials: upload completes, appears in History and opens via a signed URL. Without credentials: UI explains B2 is not configured, hides the failed 0% progress bar and offers one-click opt-in local retention |
| B2 re-analysis | Completed originals can be replayed through a signed URL. Missing/failed/in-progress uploads route to the local recovery screen; a matching opted-in file (name + exact size) reopens, otherwise **Choose original video** is shown |
| Archive recovery safety | Two videos with the same name but different sizes must not auto-match. Unknown archive size, no retained file, revoked file-handle permission, and account changes must not silently substitute unrelated footage |
| Local recovery persistence | Opening a retained original or choosing a fresh file starts a local analysis without fabricating B2 storage success. Verify the old broken ?video= link clears after successful local selection and no longer replays the error |
| Offline and reconnect | Metadata and reviewer decisions stay local offline, sync after reconnect, and refresh from cloud on foreground return (throttled) |
| Account switching | Account settings, video/capture state and tracked history do not leak between users |
| Device performance | Sustainable inference speed verified on Surface Laptop 7 / Windows ARM |
| Report clarity | Speed labels explicitly say **uncalibrated**, with no claim of measured road speed or verified offence |
| Overlay label stability | Same vehicle ID keeps a stable above/inside anchor through normal motion; adjacent detections must not cause labels to jump or flicker. Full and compact labels both keep ID and estimated speed (or a clear dash when unknown) |
| Count consistency | Dashboard, History, Analytics and Reports count repeated track IDs consistently, excluding one-frame noise while preserving raw candidate evidence; inspect ID-switch inflation separately |
| Cloudflare Workers/Pages | Production build guard, Hugging Face model/CORS, version-matched external ONNX Runtime WASM, security headers and 25 MiB limit validated on deployed HTTPS site |
| Deployment | HTTPS, secure server-side B2 credentials, RLS, rate limits and backup/recovery policy verified |

Follow the [Cloudflare Workers deployment guide](CLOUDFLARE_PAGES.md) for the precise GitHub, public Hugging Face model, OAuth and release settings. Deploying the frontend does not enable Google OAuth or guarantee model reachability.

## Connected staging database review (7 November 2026)

The connected `visionguard-staging` Supabase project has the analysis-history tables
and row-level security enabled on the public application tables checked. The
following advisor findings still require production-readiness review:

- **Role lookup:** `public.auth_user_role()` is a `SECURITY DEFINER` function
  used by many access-control policies. It reads the role only for
  `auth.uid()` from `public.profiles`, excluding disabled accounts. The
  advisor flags its `authenticated` EXECUTE permission; do **not** blindly
  revoke it, as doing so would break dependent policies. Audit the function,
  grants and policy dependencies before changing authorization.
- **Password protection:** Enable leaked-password protection in Supabase Auth
  where supported and appropriate. It was reported as disabled in staging.
- **Query optimization:** The advisor found 29 authentication/RLS function
  initialization warnings and 16 multiple-permissive-policy warnings. Review
  policy behavior and query plans before restructuring; do not weaken RLS to
  remove a warning. See the [RLS optimization guide](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).
- **Index review:** 27 unindexed foreign keys and 27 unused-index notices were
  reported. Prioritize indexes on measured hot paths; unused-index findings
  on a lightly populated staging database do not prove an index is unnecessary.

These checks are a staging snapshot, **not** proof that deployment, B2 upload,
auth recovery, YouTube capture, or real-world tracking accuracy are validated.

## Known release limitations

- Browser object detection is not a certified traffic-enforcement system.
- Camera calibration is not supplied; screen-derived km/h values are estimates.
- The automatic candidate rules cover only sustained high optical speed estimates and long stationary vehicles amid moving traffic; they are not confirmed speeding, obstructions or accidents.
- License-plate OCR, verified automatic speeding/helmet violations, and
  simultaneous multi-camera inference are **future features**, not part of v1.
- Capturing a YouTube tab requires permission on each new browser session.
- B2 remote playback/analysis needs correct signed URL, GET/Range/CORS and
  browser-decodable video.
- Real-world accuracy, especially truck/bus confusion and motorcycles,
  requires a labeled validation set and hardware testing. The historical
  YOLO11n backend benchmark is not a browser YOLO11s performance result.
  Use the [annotated quality scorecard](BROWSER_TRACKING_EVALUATION.md).

## CI checks

Run from repository root:

```powershell
npm run lint
npm run build
npm run test -w web
npm run test:deploy
npm run test:tracking-eval
```

Run the optional backend test suite in its Python environment:

```powershell
cd backend
python -m pytest
```

**Release naming:** core v1 release candidate until the unautomated
acceptance tests above pass. Passing CI alone is not enough to represent
production readiness.
