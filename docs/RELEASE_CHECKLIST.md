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
| Scene exits | Boxes disappear promptly when tracks leave the frame |
| YouTube tab | User-approved Edge-tab capture survives focus changes |
| Capture privacy | Global Stop button ends sharing; webcam releases on page hide |
| Live session history | Tracks persist across dashboard, history, analytics and reports |
| Review flags | Flag a track for speed **review**; it appears in Incidents and both report export formats |
| Reload persistence | Saved session data survives reload without duplicating IDs |
| Local video opt-in | Unchecked means original bytes are not retained across reloads |
| Optional local retention | Checked retains video only within available browser quota |
| B2 storage | Explicit upload completes, appears in History, opens via signed GET URL |
| B2 re-analysis | Archive **Analyze Again** loads video into browser detector; bucket CORS permits reading its frames |
| Offline and reconnect | Metadata stays local offline and can sync after reconnect |
| Account switching | Settings, YouTube links and tracked history do not leak between users |
| Device performance | Sustainable inference speed verified on Surface Laptop 7 / Windows ARM |
| Report clarity | Estimated speeds never described as verified offences |
| Deployment | HTTPS, secure server-side B2 credentials, RLS, rate limits and backup/recovery policy verified |

## Known release limitations

- Browser object detection is not a certified traffic-enforcement system.
- Camera calibration is not supplied; screen-derived km/h values are estimates.
- License-plate OCR, verified automatic speeding/helmet violations, and
  simultaneous multi-camera inference are **future features**, not part of v1.
- Capturing a YouTube tab requires permission on each new browser session.
- B2 remote playback/analysis needs correct signed URL, GET/Range/CORS and
  browser-decodable video.
- Real-world accuracy, especially truck/bus confusion and motorcycles,
  requires a labeled validation set and hardware testing.

## CI checks

Run from repository root:

```powershell
npm run lint
npm run build
npm run test -w web
```

Run the optional backend test suite in its Python environment:

```powershell
cd backend
python -m pytest
```

**Release naming:** core v1 release candidate until the unautomated
acceptance tests above pass. Passing CI alone is not enough to represent
production readiness.
