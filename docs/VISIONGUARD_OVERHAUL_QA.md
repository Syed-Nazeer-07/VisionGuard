# VisionGuard overhaul verification

Baseline `256d9d59dee53aa14832a47d2cf09671ec011e77`. The test environment used Debian Chromium 156, Node 24, and a two-vCPU quota. Browser workflow tests used a local Supabase HTTP fixture, synthetic camera input, and real browser IndexedDB. The footage runs used the deployed YOLO11s weights and the browser's WASM runtime.

## Audit and changes

| Priority | Evidence at baseline | Change |
| --- | --- | --- |
| High | The decoder validated the array length, which also accepts a transposed tensor. Vertical box coordinates used the horizontal letterbox scale even when resize rounding differed. | Validate tensor shape and type at initialization and inference. Invert the rounded transform separately along each axis. |
| High | Results with the wrong request ID could still be applied if their source generation matched. A retained optical track could be counted as another detector observation. | Gate results on both request and generation. Anchor optical replay to the submitted frame. Count only identities associated with that result. |
| High | A software GPU adapter initialized an ONNX session but produced zero results over a 12-second highway run. | Check adapter availability and use WASM when Chromium reports a software adapter. |
| High | Admin settings advertised a retired YOLO11n path and exposed controls without consumers in browser inference. | Make active detector settings visible and keep evidence retention editable. Existing database rows and policies are preserved. |
| High | Closing a local video deleted the opted-in original. A late permission or reload promise could report errors for a different source. | Preserve retained originals on close, provide a reopen action, release inactive workers, and discard superseded source operations. |
| Medium | The player and repeated status panels consumed the first screen at laptop widths. Source selection, file handling, and display toggles competed with playback. | Use a source bar, composite player, observation panel, and dedicated display and storage controls. Keep focus and fullscreen attached to the same media element. |
| Medium | Login discarded protected deep links. Account recovery could fall back to a pre-existing ordinary session. | Validate return paths, identify form controls, and require the Supabase password-recovery event before enabling reset. |
| Medium | React loaded chart dependencies for history and incident screens. | Load the chart only when observations are available, with an accessible text equivalent. |
| Medium | On the Linux lockfile path, the native binding repair installed dependencies but rechecked earlier misses in the same Node process. | Verify bindings in a fresh process and cover both supported external ONNX WASM artifact names in the Cloudflare build guard. |

The workspace uses a shared light palette, clear headings and compact navigation. Updated surfaces include the landing page and account forms, Overview, Live Analysis, History, Incidents, Analytics, Reports, Settings, and the admin screens. User and audit dialogs use native modal focus and dismissal. Legacy deep links and archive screens retain their existing routes.

## Browser footage evaluation

The hosted model was 38,012,145 bytes. Its SHA-256 was `d128767d8495f6cb307ed3325e1638fed77b3589e6e943624f944c0f3177ece3`. The repository validator checked COCO metadata and ONNX opset 17, with float32 input `[1,3,640,640]` and output `[1,84,8400]`.

Two clips provide a small diagnostic sample. The overhead parking-lot clip is [bundled in the repository](../apps/web/public/car-detection.mp4). The highway clip is the [Supervision vehicles sample](https://media.roboflow.com/supervision/video-examples/vehicles.mp4), transcoded to 1280 × 720 VP9 at 25 fps for this Chromium build. The same model, videos, viewport, and timestamps were used for the baseline and feature branch. Human-readable tracking references were marked from decoded frames with the overlay off. The highway annotation region covers vehicles whose box centers are at source y ≥ 200 px. The far horizon is outside the scope of this score.

| Sample | Frames / GT boxes | Before → after precision | Recall | F1 | Mean matched IoU | ID switches / duplicate pairs / exit ghost frames |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Overhead cars | 18 / 32 | 0 → 0 | 0 → 0 | 0 → 0 | No matches | 0 / 0 / 0 in each run |
| Highway cars and truck | 5 / 25 | 0 → 0.067 | 0 → 0.040 | 0 → 0.050 | No matches → 0.504 | 0 / 0 / 0 in each run |

The overhead detector missed both cars across the annotated segment. A direct CPU probe of two of those source frames produced maximum car scores of 0.034 and 0.018, with the relevant anchors voting for COCO class 67. This is model classification failure on that viewpoint. The highway match was a truck. Several visible highway boxes followed vehicles but fell below IoU 0.50 with the hand-labeled boxes. Optical replay retains the detector's box size between observations, which contributes to alignment error as vehicles approach and change scale. Slow detector cadence and small distant vehicles also limit correction opportunities.

An overhead exit was annotated at 18.32 seconds. The track was already absent from both overlays, so the zero ghost count offers little evidence about exit handling. Five highway frames and one matched box are also too few to estimate ID-switch performance. This sample establishes that the browser pipeline needs further accuracy work. There is no aggregate accuracy improvement claim. Thresholds and the model were retained, pending a comparison with a diverse labeled set.

Reproduce these exact scores from the four [labeled excerpts](qa/overhaul/) with `node scripts/evaluate-tracking.mjs <file>`. Use [the browser evaluation guide](BROWSER_TRACKING_EVALUATION.md) to capture a new sample.

## Runtime

Local headless Chromium, device pixel ratio 1, initial detector ready before playback, single trial per condition. Inference duration includes worker preprocessing and postprocessing. Raw result age is playback time at worker delivery minus capture media time. Overlay age is the rendered geometry's source age after optical updates and is sampled only when boxes are drawn. The page JS heap excludes native decode, WASM and GPU allocations. Cold first inference is included.

| Clip and version | Inference FPS | Playback FPS | Worker latency p50 / p95 | Raw result age p50 / p95 | Rendered overlay age p50 / p95 | Page JS heap start → end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Highway before | 0.34 | 22.29 | 2146 / 5722 ms | 2196 / 4659 ms | — | 47.1 → 54.0 MB |
| Highway after | 0.36 | 23.11 | 1822 / 5844 ms | 1910 / 5383 ms | 0 / 80 ms | 46.5 → 63.2 MB |
| Overhead before | 0.47 | 12.06 | 1585 / 4734 ms | 1595 / 4513 ms | — | 47.4 → 59.1 MB |
| Overhead after | 0.57 | 12.01 | 1453 / 3742 ms | 1433 / 3070 ms | No rendered boxes | 45.9 → 61.1 MB |

Video kept advancing while inference was pending. The single local trials and small inference counts do not establish a throughput improvement or memory trend. Webcam and browser tab work also need a long capture test on target hardware. The available WebGPU adapter identified itself as a software fallback. Hardware WebGPU and Windows on ARM remain unverified.

## Browser workflow coverage

The browser swept 390, 768, 1366, 1920, and 2560 px widths on 15 routes. It checked public navigation, forms, and responsive workspace layout. It also exercised focus Escape, composite fullscreen, seeking, and closing the source. [Before and after screenshots](qa/overhaul/screenshots.md) use the same fixtures.

The optional [workspace smoke test](../scripts/smoke_workspace.mjs) checks a signed-out redirect, Viewer access to admin routes, mobile focus and dismissal, admin retention, display toggles, camera release on source switch, local video opt-in and reopening, incident review persistence and CSV, and password recovery callbacks. It confines all remote data to `visionguard-fixture.invalid`. Run this fixture from separate terminals:

```bash
VITE_SUPABASE_URL=https://visionguard-fixture.invalid \
VITE_SUPABASE_ANON_KEY=sb_publishable_local_browser_test \
npm run dev -w web -- --port 3002
```

```bash
npm install --prefix /tmp/visionguard-browser playwright-core
VISIONGUARD_PLAYWRIGHT_MODULE=/tmp/visionguard-browser/node_modules/playwright-core/index.mjs \
VISIONGUARD_CHROMIUM=/usr/bin/chromium \
node scripts/smoke_workspace.mjs
```

## Automated checks

| Check | Result |
| --- | --- |
| `npm run lint` | Passed with warnings |
| `npm run build` | Passed with the large entry-chunk warning |
| `npm run test -w web` | 361 tests passed across 54 files, compared with 347 tests at baseline |
| `npm run test:architecture` | Passed |
| `npm run test:deploy` | Passed |
| `npm run test:tracking-eval` | Passed |
| `npm run build:pages` | Passed after a fresh Linux install, using the CI fixture values |
| `scripts/smoke_landing_hit_targets.py` | Passed in Chromium |
| `scripts/smoke_workspace.mjs` | Passed through eleven browser workflow checks |

## Remaining release gates

- Run a labeled holdout with congested streets, small motorcycles and bicycles, buses, night footage, and sustained occlusion. Compare model candidates and optical replay geometry separately.
- Benchmark WebGPU and WASM on Surface Laptop 7 and a typical Windows Chrome or Edge machine. Verify at least 30 minutes of capture and browser-process memory.
- Verify an authorized real browser-tab selection, OAuth and recovery email, B2 upload and signed URLs, account isolation across sessions, and interrupted online synchronization with a staging account.
- The empty and initial loading layouts were included in the viewport sweep. Admin list expansions and all historical data combinations still need wider browser coverage.
