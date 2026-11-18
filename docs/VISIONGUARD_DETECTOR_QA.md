# Browser detector and tracking verification

Baseline `9791c4b` from the merged overhaul. Measurements used Chromium 156 on Linux x86-64 with a two-vCPU quota. The same 38,012,145-byte YOLO11s ONNX file was used for paired runs. Its SHA-256 is `d128767d8495f6cb307ed3325e1638fed77b3589e6e943624f944c0f3177ece3`. The baseline worker was instrumented to report its raw boxes and startup phases without changing its detector or tracker. Raw boxes in this report are the detector candidates after the application's confidence filtering and NMS, before temporal tracking.

## What caused the failures

- **Highway**. Fixed-frame detections matched 20 of 25 hand-labeled car and truck boxes. The remaining misses were cars. Between model calls, the live tracker could spend over a second following an old box with translation alone. That left a distant box undersized as its car approached, even when some features still moved with the vehicle. Subpixel patch matching reduces position quantization. Box size now follows agreeing optical features when their motion supports a scale change. Recent detector observations can correct moderate size errors more quickly. The capture timestamp is carried through replay, so delayed observations cannot make an old detector confirmation look new.
- **Overhead**. At exact annotated frames, YOLO11s found 7 of 32 labeled cars. No live overlay was drawn in either full playback trial. An independent CPU ONNX probe reproduced the missed cars. Rotating the tested frames by 90°, 180°, and 270° reduced correct detections to 3, 1, and 1. The previous probe measured maximum car scores of 0.034 and 0.018 on two missed frames. The tensor dimensions, RGB normalization, rounded letterbox inversion, and class indices were checked against the raw output. The observed misses come primarily from weak model evidence on this viewpoint.
- **Crowded street**. YOLO11s labeled the same KITTI truck as a bus in 16 of 20 frames, with box IoU 0.779–0.928. The competing truck score was below the winning bus score every time and below 0.33 in 15 of those 16 frames. The model assigned the wrong class before ByteTrack or optical replay. Distant and occluded targets were also missed. There is no global confidence, class-mapping, NMS, or association threshold change.
- **Startup and inference**. The old path probed the model and fetched it again through ONNX Runtime. It also initialized a runtime build that bundled WebGPU support for CPU-only sessions. The worker now downloads one binary per initialization attempt, reuses it when provider initialization falls back, and imports the matching runtime. The browser HTTP cache and model endpoint validators handle repeats. The worker reuses its input tensor, reads only the image region from its canvas, rejects below-threshold anchors before scanning all classes, and disposes output tensors and frame bitmaps. A single in-flight request bounds work when playback outruns the model.
- **Recovery**. Live Analysis shows real download and initialization stages. An interrupted request reports an error while video continues. Retry starts a fresh worker, with WASM selected after a stall or crash. Paused **Inspect frame** runs the real detector on the current image. It displays candidates without IDs and uses no tracker or observation ledger. Seeking, switching sources, or resuming removes the inspection.

## Accuracy on human-labeled sources

IoU ≥ 0.50 with class-aware matching. Values below were identical before and after for both the raw candidates and the worker's detector-frame tracking metrics. This comparison measures detector coverage and the association stage at the annotated timestamps. The optical replay and uninterrupted playback measurements follow separately.

| Source | Frames / labeled boxes | Raw TP / FP / FN | Precision | Recall | F1 | Mean matched IoU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Highway | 5 / 25 | 20 / 0 / 5 | 1.000 | 0.800 | 0.889 | 0.837 |
| Overhead | 18 / 32 | 7 / 0 / 25 | 1.000 | 0.219 | 0.359 | 0.912 |
| KITTI crowded street | 20 / 297 | 180 / 38 / 117 | 0.826 | 0.606 | 0.699 | 0.766 |
| COCO street images | 2 / 32 | 12 / 7 / 20 | 0.632 | 0.375 | 0.471 | 0.805 |

| Video | Worker TP / FP / FN | Precision / recall / F1 | Mean matched IoU | ID switches / duplicate pairs / exit ghost frames |
| --- | ---: | ---: | ---: | ---: |
| Highway | 20 / 0 / 5 | 1.000 / 0.800 / 0.889 | 0.837 | 0 / 0 / 0 |
| Overhead | 7 / 0 / 25 | 1.000 / 0.219 / 0.359 | 0.912 | 0 / 0 / 0 |
| KITTI | 174 / 32 / 123 | 0.845 / 0.586 / 0.692 | 0.770 | 3 / 0 / 0 |

KITTI includes 277 car/van and 20 truck annotations. Cars matched 178/277 and trucks matched 2/20 before tracking. In the COCO images, matches by class were cars 1/2, bicycles 1/9, motorcycles 6/14, buses 2/3, and trucks 2/4. Those two images are class and scale checks. They supply no time sequence for tracking. Many small riders were missed. On KITTI, this is VisionGuard's evaluator. Car and Van use the same label and excluded categories and DontCare regions are outside the annotation set. The evaluator does not implement KITTI's ignore-region protocol.

### Controlled optical replay on actual highway video

Both versions seeded tracks at the same detector timestamps, then advanced the same 120 ms image sequence without intermediate detections. The six independently labeled endpoints span 7.64–8.24 s. The numeric difference comes from optical tracking on decoded footage. This test excludes wall-clock inference scheduling and shows performance at four specified seed ages.

| Seed timestamp | Before → after TP / FP / FN | Precision | Recall | F1 | Mean matched IoU |
| --- | --- | --- | --- | --- | --- |
| 6.44 s | 9/12/21 → 18/0/12 | 0.429 → 1.000 | 0.300 → 0.600 | 0.353 → 0.750 | 0.579 → 0.581 |
| 6.92 s | 18/6/12 → 18/6/12 | 0.750 → 0.750 | 0.600 → 0.600 | 0.667 → 0.667 | 0.652 → 0.650 |
| 7.40 s | 18/0/12 → 18/0/12 | 1.000 → 1.000 | 0.600 → 0.600 | 0.750 → 0.750 | 0.758 → 0.776 |
| 7.64 s | 20/0/10 → 20/0/10 | 1.000 → 1.000 | 0.667 → 0.667 | 0.800 → 0.800 | 0.775 → 0.804 |

There were zero ID switches and duplicate prediction pairs in these replay windows. No exits occurred in the six frames. The previous overhead labels include one exit, but live overlays had already lost the vehicles. Zero observed ghost frames provide limited evidence about sustained tracking through an exit.

In a separate paired single-thread playback run, six identical labeled highway timestamps produced **0 TP / 0 FP / 30 FN** at baseline and **0 TP / 12 FP / 30 FN** after the initial scale change, before subpixel matching. The 12 unmatched boxes followed two cars but fell below IoU 0.50. The final isolated playback sampled different media timestamps across runs and cannot be scored against that six-frame pair. These measurements do not establish a general live-overlay accuracy improvement. [Highway replay labels](qa/detector/highway-replay-labels.json)

### Sources and evaluation boundaries

- The highway sample is Supervision's vehicles video, transcoded to 1280 × 720 VP9 at 25 fps. The annotated region includes vehicles whose box centers are at source y ≥ 200 px. Distant horizon vehicles are outside this score. The fixed-frame benchmark uses the five timestamps in the previous QA report. The controlled replay has six separately hand-labeled times, drawn from the images with the overlay off. [Video](https://media.roboflow.com/supervision/video-examples/vehicles.mp4) · [Fixed-frame labels](qa/overhaul/after-road.json)
- The overhead sample is the bundled `car-detection.mp4`. It used the existing independently labeled frames and the transcode needed for this Chromium installation. [Bundled video](../apps/web/public/car-detection.mp4) · [Labels](qa/overhaul/after-overhead.json)
- The congested daytime street excerpt uses KITTI tracking training sequence 0009, camera 02, source frames 208–227, at 10 fps. Frames were encoded as 4:4:4 lossless VP9 at original resolution. Bounding boxes and IDs come from `training/label_02/0009.txt` in the official annotations. [KITTI tracking dataset and license](https://www.cvlibs.net/datasets/kitti/eval_tracking.php)
- COCO 2017 validation images 254814 and 125572 were fit inside 960 × 540, with black padding, and packed as two lossless VP9 frames at 1 fps for the browser runner. Their official human boxes were converted from Ultralytics' COCO-derived normalized annotations with the same resize and padding. [COCO](https://cocodataset.org/#download) · [Image 254814](https://images.cocodataset.org/val2017/000000254814.jpg) · [Image 125572](https://images.cocodataset.org/val2017/000000125572.jpg)
- These excerpts cover daytime visibility, busy traffic, occlusions and some distant targets. A scored nighttime clip, a long moving two-wheeler sequence, and a labeled continuous intersection and exit set remain pending. No suitable independently labeled sequences for those cases were included in this run.

## Runtime measurements

Times in milliseconds. Startup runs from sending init until the worker confirms a valid session. Latencies include worker preprocessing, execution and postprocessing. Warm excludes the first frame. Each row is one local trial except the explicit cache repeat. Startup varies with browser and disk cache state. Warm WASM speed was mixed outside the isolated highway trial.

| Model and diagnostic clip | Startup | First worker frame | Warm p50 / p95 |
| --- | ---: | ---: | ---: |
| YOLO11s highway before, one thread | 3,354 | 2,295 | 1,091 / 1,147 |
| YOLO11s highway after, one thread | 2,050 | 1,202 | 1,038 / 1,082 |
| YOLO11s highway after, repeat context | 1,285 | 1,347 | 1,049 / 1,061 |
| YOLO11s overhead before, one thread | 2,302 | 1,689 | 1,078 / 1,181 |
| YOLO11s overhead after, one thread | 1,899 | 1,263 | 1,124 / 1,324 |
| YOLO11s highway before, isolated | 6,722 | 3,254 | 1,176 / 1,212 |
| YOLO11s highway after, isolated with two WASM threads | 2,099 | 993 | 746 / 944 |
| YOLO11n highway, one thread | 1,085 | 524 | 388 / 399 |
| YOLO11n overhead, one thread | 1,043 | 536 | 361 / 403 |

In the first same-origin highway startup after the change, reading the model took 525 ms, the overlapping adapter probe 102 ms, importing the runtime 76 ms, and constructing the WASM runtime and session together 1,228 ms. Tensor contract validation took 0.2 ms. The public ORT API returns a session after runtime and provider setup complete, so their combined duration is reported. Model byte validation occurs inside the download step. Reading the model on the repeat took 340 ms. No cache-hit status was inferred from elapsed time. Median capture, preprocessing, model execution, and postprocessing in that first highway run were 14.2, 7.6, 1,061.9, and 1.3 ms. The model dominates CPU latency.

In the uninterrupted, isolated highway trials the baseline and feature played approximately 19 seconds of media each, with the detector ready when playback began. Rates below use the measured wall time. Playback FPS counts presented frames after subtracting native drops. Result age is the video time at delivery less the request's capture time. Overlay age describes how recent the geometry is on sampled frames that drew a box. Low overlay age can coexist with poor alignment.

| Metric | Before | After |
| --- | ---: | ---: |
| Playback FPS | 21.90 | 23.87 |
| Completed inferences / wall time | 8 / 20.78 s | 10 / 19.10 s |
| Inference FPS | 0.385 | 0.524 |
| Worker latency p50 / p95 | 1,735 / 5,889 ms | 1,680 / 2,273 ms |
| Result age p50 / p95 | 1,831 / 4,576 ms | 1,764 / 2,312 ms |
| Rendered overlay age p50 / p95 | 0 / 0 ms | 0 / 40 ms |
| Dropped video frames | 23 | 20 |
| Presented frames seen while inference was busy | Uninstrumented | 217 |
| Page JS heap start → end | 46.7 → 57.8 MB | 48.1 → 60.3 MB |

The final app trace measured capture 11.7 / 82.3 ms and replay 14.7 / 50.9 ms p50 / p95. The isolated playback sample is short and the p95 is sensitive to a single slow frame. The heap estimate excludes worker and native allocations, video decode, WASM memory, and GPU memory. It cannot establish the browser's memory ceiling or long-run trend. Windows on ARM and its hardware GPU were unavailable. Chromium verified local WASM execution with and without cross-origin isolation. The production package served the hashed CPU binary from the app origin and ran with two WASM threads.

### Model choice

YOLO11n did less work but matched only 13/25 highway boxes and 2/32 overhead boxes versus 20/25 and 7/32 for YOLO11s. Nano recall was 0.520 for highway and 0.063 for overhead, with one overhead false positive. The two YOLO11n files used for the browser and rotation probes were the same pinned 10,741,397-byte export. Keep YOLO11s as the default and evaluate a compatible model trained or validated on overhead traffic before changing the default. YOLO11m was outside this paired browser test. Matching the existing ONNX contract, file size, browser memory, and real GPU support still needs verification for any larger model. No additional model weights are bundled.

The browser ONNX format requires float32 input `[1,3,640,640]` and a COCO output `[1,84,8400]`. The YOLO11n test export identifies AGPL-3.0. Ultralytics distributes YOLO11 under AGPL-3.0 or its Enterprise terms. Confirm the terms for the exact deployed artifact and use case before changing distribution. The Cloudflare asset limit is 25 MiB per file, so the 38 MB small model needs the existing public model endpoint for deployment. [Ultralytics licensing](https://www.ultralytics.com/license) · [Nano test export](https://huggingface.co/vitorsalomao/yolo11n-onnx/tree/f6e6632dd00304494343d672b093bd0e9ee99a47)

## Run the same benchmark on a Surface Laptop 7

Use native ARM64 Node.js 24, native Microsoft Edge, and FFmpeg. In Task Manager, confirm the Edge and Node architecture. Keep the laptop's power mode and charger state consistent. Close heavy tabs and use the same video, browser version and app checkout for each provider.

From the repository root, prepare the public test weights and footage in PowerShell. The model path is gitignored.

```powershell
npm ci
npm install --no-save --package-lock=false playwright
New-Item -ItemType Directory -Force apps/web/public/models, .bench | Out-Null
Invoke-WebRequest 'https://huggingface.co/SyedNazeer07/visionguard-yolo11s/resolve/main/yolo11s.onnx' -OutFile apps/web/public/models/yolo11s.onnx
Get-FileHash apps/web/public/models/yolo11s.onnx -Algorithm SHA256
Invoke-WebRequest 'https://media.roboflow.com/supervision/video-examples/vehicles.mp4' -OutFile .bench/vehicles.mp4
ffmpeg -y -i .bench/vehicles.mp4 -vf 'scale=1280:720,fps=25' -an -c:v libvpx-vp9 -crf 26 -b:v 0 .bench/road-720p.webm
$env:VISIONGUARD_BENCH_ISOLATION = '1'
npm run dev -w web -- --port 3000
```

With Vite running, use a second PowerShell window from the same checkout. The Edge channel uses the installed browser. Use `--channel chrome` for an installed native Chrome or `--executable` for a specific binary. The first run uses a fresh browser context. The second run uses the same context and creates a fresh worker and model session.

```powershell
$clip = '.bench/road-720p.webm'
$truth = 'docs/qa/overhaul/after-road.json'
node scripts/benchmark_detector.mjs --channel msedge --headed --isolated --provider auto --video $clip --annotations $truth --roi-min-y 200 --repeat 2 --out .bench/surface-auto.json
node scripts/benchmark_detector.mjs --channel msedge --headed --isolated --provider wasm --video $clip --annotations $truth --roi-min-y 200 --repeat 2 --out .bench/surface-wasm.json
node scripts/benchmark_detector.mjs --channel msedge --headed --isolated --provider wasm --video $clip --annotations docs/qa/detector/highway-replay-labels.json --roi-min-y 200 --replay-anchors 6.44,6.92,7.40,7.64 --out .bench/surface-replay.json
```

- Inspect `ready.provider`, `ready.fallbackReason`, `ready.startup.adapter`, and `ready.startup.wasmThreads`. With automatic selection, verify the adapter in `edge://gpu` and that the Qualcomm Adreno GPU shows compute activity during inference. ONNX Runtime can execute unsupported GPU operators on the CPU. A session reporting WebGPU alone is insufficient to measure hardware acceleration.
- For an uninterrupted run, open **Live Analysis** with `?quality=1`. Load the local clip, pause and wait for **Detector ready**, seek to the beginning, then play to a consistent timestamp and export **Download QA trace**. Repeat with `?quality=1&engine=wasm`. The JSON `benchmark` includes inference FPS, playback FPS, worker/capture/replay percentiles, source ages, native drops, and observed busy frames. QA trace precision and recall require independently labeled media timestamps. [Overlay evaluation guide](BROWSER_TRACKING_EVALUATION.md)
- Record process and GPU memory from Edge Browser Task Manager and Windows Task Manager before opening video, at ready, and after 5 and 30 minutes. Test a camera or permitted browser tab for the sustained run. Keep the same task windows and capture settings between providers. The trace supplies the page JS heap estimate if Chromium exposes it.
- To test one-thread WASM, unset `VISIONGUARD_BENCH_ISOLATION`, restart Vite, and repeat the forced-WASM command without `--isolated`. The isolated flag verifies the page received the headers that allow WASM threads.

## Browser and automated checks

| Check | Result |
| --- | --- |
| `npm run lint` | Passed with existing lint warnings |
| `npm run build` | Passed with the existing large entry-chunk warning |
| `npm run test -w web` | 363 tests passed across 55 files |
| `npm run test:architecture` | 3 passed |
| `npm run test:deploy` | 23 passed, including conditional model requests |
| `npm run test:tracking-eval` | 9 passed |
| `npm run build:pages` | Local package validation passed with fixture public configuration and an external model URL |
| `scripts/smoke_workspace.mjs` | 11 Chromium checks passed across authentication, roles, local camera/file switching, local retention, review, and recovery |
| Live Analysis model retry | Interrupted the real model GET, observed playback continue, then retried successfully with forced WASM |
| Paused frame and seek | Four detector candidates rendered on the labeled highway image; the inspection cleared on seek and a new live QA trace exported after resume |
| Production package | Local Chromium fetched its hashed CPU runtime binary and ran the real model with two WASM threads |
| Automatic fallback | Chromium exposed a software WebGPU adapter. VisionGuard chose WASM and completed inference |

Browser smoke used local HTTP fixtures and Chromium IndexedDB. Authenticated production OAuth/recovery email, actual B2 uploads, real camera and tab permission selection, Windows ARM hardware WebGPU, sustained memory profiling, and a long labeled night/replay holdout still require staging or device testing. The existing speed estimate remains uncalibrated and cannot prove a violation.

[Recorded benchmark summaries](qa/detector/measurements.json) · [Paused frame inspection screenshot](qa/detector/frame-inspection.jpg) · [Prior overhaul verification](VISIONGUARD_OVERHAUL_QA.md)
