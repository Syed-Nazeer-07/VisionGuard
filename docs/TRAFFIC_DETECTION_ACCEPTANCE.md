# Real traffic detection acceptance — screenshot regression

## User-reported problem (2026-11-07)

In the reported street-footage screenshot:
- A **CAR** track is drawn on a circular manhole cover near the lower middle/right.
- A **PERSON** track is drawn around a roadside bollard on the lower left.
- Some moving-car boxes do not stay tightly aligned with visible vehicles.
- The video unexpectedly slows down (legacy auto-enabled AI-sync).
- No per-car km/h appears, despite having no surveyed calibration configured.

This screenshot is a **failure report**, not a real-detector benchmark:
it does not reveal source video frames, raw logits, per-class confidence,
actual inference timestamps, or ground-truth speed.

## Concrete source fixes in recovery PR #11

1. Normal video playback defaults to **1.00×** and ignores the old,
   automatically-enabled localStorage setting. Slowing to AI FPS is now
   explicitly opt-in and visibly labelled.
2. Precision-first detection default is **0.40** for cars/trucks/buses;
   person candidates require **0.58**; small motorcycles/bicycles use a
   lower effective gate (**0.30** in balanced mode). The optional High
   Recall profile uses 0.25 and may increase false positives.
3. Car/person tracks require **three matched detector observations**
   before appearing. Motorcycles/bicycles require two, due to smaller size
   and lower recall. Phantom predicted tracks cannot reset observation age.
4. Rendering begins from the newest *actual detection box*, not a
   lagged/smoothed blend. Bounded interpolation applies only briefly;
   last-seen tracks now expire after 0.45 seconds of video time.
5. **Show detection confidence** adds per-box scores to the overlay.
   This helps tell apart threshold errors from genuine class mistakes.
6. A properly calibrated ground-plane reference is mandatory for km/h.
   Invalid or missing calibration shows no made-up physical speeds.

None of these code changes can reliably reject a **high-confidence**
manhole/vehicle misclassification if the pretrained model itself is
incorrect. A fixed heuristic that deletes circles/short vehicles may
also delete genuine motorcycles.

## Try a stronger pretrained model

GitHub main now includes the manual
**Export YOLO11 ONNX (n/s/m, manual license acknowledgement required)**
workflow, introduced by PR #12. After independently reviewing the
Ultralytics weights/license and explicitly acknowledging it, export
`s` and download the workflow artifact named
`visionguard-yolo11s-onnx`.

Copy `yolo11s.onnx` to:
`apps/web/public/models/yolo11s.onnx`

Then set **in the repository-root `.env`**:

```env
VITE_YOLO_MODEL_PATH=/models/yolo11s.onnx
```

Restart Vite. The existing `yolo11n.onnx` continues to work when this
variable is omitted or set to `/models/yolo11n.onnx`.

Official Ultralytics COCO-val box-mAP50–95 figures at 640 pixels:
YOLO11n **39.5**, YOLO11s **47.0**, YOLO11m **51.5**.
They **do not** predict your traffic-video false-positive rate, nor
real FPS on the Snapdragon X Elite / Windows on ARM device. Larger models
require more computation; compare the observed FPS before recommending
one as the final production model.

Source: https://docs.ultralytics.com/models/yolo11

## Repeatable acceptance test

Use the actual **unmodified original 12-second MP4**, not a screenshot
with old labels baked into the pixels. Keep the same model, browser,
profile and input clip when comparing code changes.

1. Start Browser AI, **Full Detection**, Balanced, **1.00× playback**.
2. Enable **Show detection confidence**. Record the scores and approximate
   media times for any CAR on a manhole or PERSON on a bollard.
3. Repeat with YOLO11s and the **same profile**. Count false positives
   on those two physical static objects over every processed frame.
4. Check that each real car uses one mostly stable ID, and that overlay
   boxes overlap the actual visible vehicle instead of moving onto
   road markings. Record dropped frames and inference latency.
5. Repeat with motorcycles/distant objects. Count missed motorcycles;
   a strict confidence filter can improve precision while reducing recall.
6. When the video is paused or seeked, verify no previously detected
   track follows a different frame.
7. For speed, select a measured quadrilateral on the road, specify its
   surveyed physical dimensions, then compare against a vehicle with
   independently known speed. Do not use estimated km/h for enforcement.

Before asserting "working," collect *at least*:
- Per-class precision/recall against annotated frames;
- ID switches and per-frame box IoU for tracked vehicles;
- Actual inference FPS, display FPS and stale-overlay fraction;
- Speed MAE (km/h) on surveyed ground-truth footage.

## If YOLO11s is still incorrectly detecting the manhole

The next fix is to gather **road-surface hard negatives and labeled vehicle
examples** from authorized videos and train/fine-tune a traffic-specific
detector. More thresholds or guesses about bounding-box geometry will not
reliably distinguish high-confidence false positives from real small
vehicles. Consider validating a second independent detector and comparing
precision/recall before adding it to production.

**Current status:** Source fixes and synthetic tests committed.
Real-video results still **unmeasured**; do not merge PR #11 based only
on green CI.
