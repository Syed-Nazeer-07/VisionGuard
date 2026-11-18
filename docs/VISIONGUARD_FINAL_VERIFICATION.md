# VisionGuard production verification

PR #16 remains open against `main`. The continuous-playback baseline is the original PR commit `b177088`. The merged workspace baseline is `9791c4b`. Public HTTPS was tested separately. The deployed entry bundle observed on 18 November 2026 was `/assets/index-Dpedmfy3.js`. Its Git revision could not be established from public response metadata. [Pull request](https://github.com/Syed-Nazeer-07/VisionGuard/pull/16)

## Verified fixes

- Live overlays now require the optical-history frame to have the exact detector capture timestamp. The previous fallback could anchor a result to a nearby decoded frame. Optically updated tracks expire after 3.5 source seconds without a detector confirmation, even if background texture continues to match. The UI separates the age of the last detector result from the age of the painted overlay. It reports inference throughput below one update a second and points users of recorded footage to **Inspect frame**.
- Optical patch matching stops evaluating candidates that already exceed the best cost. The compared kernel used six decoded KITTI frames and five identical detector observations, repeated in alternating order in Node 24. Median time for those five updates was **18.0 → 11.7 ms**. The same 29 track identities survived and the maximum change to geometry or velocity was below `1.5e-14`. This isolated measurement excludes video decode, canvas operations, model execution, and browser scheduling.
- The password recovery button now closes the recovery session in the current browser before opening sign-in. An actual local GoTrue recovery flow previously updated the password successfully but redirected **Continue to sign in** into the workspace.
- Archive metadata, stored video bytes, and duplicate lookups now have owner and authorized staff access rules. The B2 function verifies the original object belongs to the requested video and checks access before signing. Signed responses are private and non-cacheable. The legacy Supabase archive player requests signed URLs.
- The model proxy rejects partial upstream bodies and retains conditional revalidation. The public model GET returned the same SHA-256 as the benchmark weights. Metadata now describes browser vehicle analysis and human review.

## Continuous playback on independently labeled video

Chromium 156 ran on Linux x86-64 with two vCPUs. Each pair used the same video, WASM-only mode, cross-origin isolation, actual playback at 1×, and YOLO11s with the same weights. The original PR baseline received only the opt-in dense QA sampling change. The scorer compares timestamp keys at millisecond precision and scores only frames present in both traces. It does not interpolate labels or match a prediction to a neighboring frame. Sample coverage is reported because the browser sometimes skipped paints. Lower source ages can coexist with badly placed boxes.

| Scene and trial | Shared frames | Before → after true / false positives / missed boxes | Precision | Recall | F1 | Mean matched IoU |
| --- | ---: | --- | --- | --- | --- | --- |
| Highway 1 | 5 | 1/1/7 → 0/1/8 | .500 → 0 | .125 → 0 | .200 → 0 | .506 → — |
| Highway 2 | 6 | 0/4/7 → 0/5/7 | 0 → 0 | 0 → 0 | 0 → 0 | — |
| KITTI street 1 | 60 | 0/92/716 → 0/65/716 | 0 → 0 | 0 → 0 | 0 → 0 | — |
| KITTI street 2 | 63 | 11/71/744 → 0/67/755 | .134 → 0 | .015 → 0 | .026 → 0 | .594 → — |
| Overhead 1 | 17 | 0/0/30 → 0/0/30 | 0 → 0 | 0 → 0 | 0 → 0 | — |
| Overhead 2 | 4 | 0/0/8 → 0/0/8 | 0 → 0 | 0 → 0 | 0 → 0 | — |

All six comparisons had zero detected ID switches, duplicate pairs, and exit-ghost frames. The lack of matches makes these stability results weak. The only meaningful before/after center-jitter sample was the KITTI trial 2 baseline, with `.032` mean frame-to-frame change of center error normalized by the labeled box dimensions. For matched boxes, jitter removes the vehicle's real movement. The exact counts, measurement timings, startup phases, page heap, capture timings and per-class scores are included in the JSON. [Measured continuous-playback trials](qa/final/live-measurements.json)

| Scene and trial | Inference FPS | Presented playback FPS | Worker p50 / p95, ms | Result source age p50 / p95, ms |
| --- | --- | --- | --- | --- |
| Highway 1 | .58 → .30 | 24.78 → 20.50 | 1378/2388 → 1846/4497 | 1480/2400 → 1920/4480 |
| Highway 2 | .58 → .53 | 23.64 → 24.09 | 1570/2266 → 1655/2313 | 1600/2240 → 1680/2440 |
| KITTI street 1 | .38 → .32 | 5.85 → 6.30 | 2162/2890 → 2141/4031 | 1600/2000 → 1700/2100 |
| KITTI street 2 | .38 → .33 | 5.79 → 6.49 | 2092/2620 → 2412/2729 | 1600/1900 → 1900/2100 |
| Overhead 1 | .57 → .68 | 11.71 → 11.88 | 1394/3967 → 1285/1814 | 1360/3360 → 1200/1600 |
| Overhead 2 | .11 → .14 | 9.26 → 9.48 | 5760/7600 → 4640/6000 | 5760/7600 → 4640/6000 |

The comparison **did not establish an improvement in continuous detection accuracy or general throughput**. The small number of inferences and stressed VM make single-run timing variable. The recorded highway and KITTI results include worse accuracy and sometimes lower throughput on the final branch. In those clips, results arrived roughly 1.2–4.5 seconds behind playback in typical sampled conditions. During that time vehicles change scale, become occluded, or leave the scene. Correct raw detector output at one timestamp can still be unusable by the time live overlay replay runs.

Fixed-frame results remain the diagnostic reference for detector coverage. YOLO11s matched 20/25 highway and 7/32 overhead boxes. On the fixed-frame KITTI excerpt, the detector consistently put bus boxes on the same truck before any tracking ran. The two COCO images provided small-object class checks. Six of 22 labeled bicycles and motorcycles with projected input-box area below 1,024 pixels matched at IoU 0.50. Thresholds, decoder calibration, and default weights were kept. [Fixed-frame metrics and label sources](VISIONGUARD_DETECTOR_QA.md)

Slower playback and a benchmark-only YOLO11n build were investigated. Both offered more matches in one KITTI trial and also produced unmatched or exited tracks. Nano raised inference from about .34 to .84 FPS in that trial, yet its continuous F1 was only .048. A wider optical thumbnail and longer retention for unmatched tracks were also tried and removed. A production accuracy claim requires representative nighttime, moving two-wheeler, and longer occlusion footage. Native Surface Laptop 7 hardware, hardware WebGPU use, and sustained process/GPU memory remain unverified.

### Reproduce the continuous comparison

1. Use the [Surface Laptop 7 setup and fixed-frame benchmark](VISIONGUARD_DETECTOR_QA.md#run-the-same-benchmark-on-a-surface-laptop-7).
2. On each checkout open Live Analysis with `?quality=1&qaFrames=decoded&engine=wasm`. Select the same local file, wait for detector readiness, and play from zero at 1× to the same stop point. Export each QA trace without seeking after playback starts.
3. Score the exported traces with the shared label set. Leave off `engine=wasm` in a separate run to test auto selection.

```powershell
node scripts/evaluate_live_trace.mjs --roi-min-y 320 docs/qa/final/highway-continuous-labels.json .bench/before.json .bench/after.json
```

The [highway labels](qa/final/highway-continuous-labels.json) cover 16 independently hand-labeled timestamps in a near-road region. The overhead uses the existing [bundled labels](qa/overhaul/after-overhead.json). KITTI used training sequence 0009, camera 02, frames 175–264 at 10 fps, encoded as lossless 4:4:4 VP9 at original dimensions. Box positions and IDs come from the official annotations, with Van mapped to Car and non-vehicle or ignore regions excluded. Exits are marked when an edge-touching labeled vehicle remains absent in the next five source frames. This is a VisionGuard evaluation, with its own class and ignore-region rules. [KITTI tracking dataset and terms](https://www.cvlibs.net/datasets/kitti/eval_tracking.php)

## Product workflows and release evidence

| Area | Verified | Remaining boundary |
| --- | --- | --- |
| Public signed-out behavior | Fresh Chromium sessions reaching `/app` and `/app/analyze` both rendered sign-in without a page exception. | The reported blank screen was not reproduced. |
| Account lifecycle | Real local GoTrue, PostgREST, PostgreSQL and a local SMTP inbox exercised registration, confirmation, email/password, deep-link return, reload session restoration, Viewer role denial, logout, reset email, password update and sign-in with the new password. Live public Google authorization returned a 302 to Google with the correct application return URL. | A completed production Google exchange, hosted email delivery and provider settings need a designated staging account. |
| Browser and workspace | Chromium checked 15 routes at 390, 768, 1366, 1920 and 2560 px with no horizontal overflow or page errors. Browser workflow tests covered local file retention, camera-to-file handoff, authorized fixture-tab capture, focus/Exit, incident review persistence, PDF and CSV generation, admin keyboard handling, and recovery. | Camera input used a Chromium test source. Hardware and mobile browser-specific camera permission behavior need devices. |
| Detector | The public model bytes matched benchmark weights. Local runs verified real worker inference, forced WASM, loading, recovery after failed download, paused inspection, seek and resume, and composite fullscreen. | Hardware GPU execution is unavailable in this environment. The signed-off current live site was only tested signed out. |
| Archive and storage | Migration tests on disposable PostgreSQL ran as the owner, unrelated Viewer, Operator, disabled account and anonymous role. Local tests verified canonical B2 object paths and Deno type-checked the Edge Function. | A full hosted Supabase migration, signed B2 multipart upload/download, interrupted transfer, storage cleanup, and production account synchronization need staging credentials. |
| Build | Six requested npm checks passed. The local production-style package excluded the oversized GPU WASM duplicate and Wrangler dry-run validated Worker routing/assets. | Cloudflare's managed branch check previously failed on PR #16 and PR #15 without publishing the provider logs to GitHub. Account-side build log access is required to establish its cause. |

### Coordinated archive rollout

The archive change requires the frontend, `video-storage` Edge Function, and `20261118112525_protect_archived_video_storage.sql` together. Run them against staging first. The migration makes the legacy `videos` bucket private, removes legacy upload policies and restricts archive metadata by role. Current uploads use B2. Owners retain access to their recorded objects and authorized staff can review ownerless historical objects. A historical original outside its canonical directory requires administrator review before deletion. Check any external links to the formerly public legacy bucket, archive playback with signed URLs, and both owner and staff access before authorizing production changes. The app and migration were evaluated locally. No live infrastructure changes were made.

Run `scripts/test_archived_video_access.sql` with `psql -v ON_ERROR_STOP=1 -f scripts/test_archived_video_access.sql` against a disposable migrated database. The script rolls back its fixture rows.

The public Hugging Face model repository exposed no license declaration in its model-card metadata when checked. Ultralytics offers AGPL-3.0 and Enterprise terms. Confirm the exact export's provenance and applicable distribution terms before representing the hosted artifact as cleared for redistribution. [Model repository](https://huggingface.co/SyedNazeer07/visionguard-yolo11s) · [Ultralytics licensing](https://www.ultralytics.com/license)

[Pause and inspect screenshot](qa/detector/frame-inspection.jpg) · [Architecture](ARCHITECTURE.md) · [Earlier detector verification](VISIONGUARD_DETECTOR_QA.md)
