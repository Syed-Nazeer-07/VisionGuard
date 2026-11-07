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
| Capture privacy | Global Stop button ends sharing; webcam releases on page hide |
| Live session history | Tracks persist across dashboard, history, analytics and reports |
| Review flags | Sustained high-speed estimates and stopped vehicles amid moving traffic automatically create review candidates, alongside manual flags; confirm they appear in Incidents and report exports |
| Reload persistence | Saved session data survives reload without duplicating IDs |
| Local video opt-in | Unchecked means original bytes are not retained across reloads |
| Optional local retention | Checked retains video only within available browser quota |
| B2 storage | Explicit upload completes, appears in History, opens via signed GET URL |
| B2 re-analysis | Archive **Analyze Again** loads video into browser detector; bucket CORS permits reading its frames |
| Offline and reconnect | Metadata stays local offline and can sync after reconnect |
| Account switching | Settings, YouTube links and tracked history do not leak between users |
| Device performance | Sustainable inference speed verified on Surface Laptop 7 / Windows ARM |
| Report clarity | Estimated speeds never described as verified offences |
| Cloudflare Workers/Pages | Production build guard, Hugging Face model/CORS, version-matched external ONNX Runtime WASM, security headers and 25 MiB limit validated on deployed HTTPS site |
| Deployment | HTTPS, secure server-side B2 credentials, RLS, rate limits and backup/recovery policy verified |

Follow the [Cloudflare Pages deployment guide](CLOUDFLARE_PAGES.md) for the precise GitHub, model/R2, OAuth and release settings. Deploying only the frontend does not activate Google OAuth or provision a model.

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
