# Recorded-video accuracy-first mode: acceptance protocol

Frame-locked analysis is an **optional recorded-video mode**, not a real-time inference speedup. It pauses the source media clock while the actual YOLO11s worker analyzes a frame, then briefly advances to the next sample. Webcams and user-approved browser-tab capture never use this mode.

## Test the actual product, not just the playback-rate policy

Use a private/staging account and an unchanged copy of the same video for three trials:

1. **Native 1×:** turn off both **Sync video to AI** and **Frame-locked analysis**.
2. **Adaptive Sync:** enable **Sync video to AI** (only one mode at a time).
3. **Frame-locked:** enable **Frame-locked analysis** (the other mode must turn off).

For each recorded clip, start with a fresh analysis session, wait for **Detector ready**, seek to 00:00, and play until the same source-media timestamp. Use **Live Analysis** with `?quality=1&qaFrames=decoded&engine=wasm` to export **Download QA trace** separately for each trial. Use `?quality=1&qaFrames=decoded` in additional runs to compare hardware WebGPU selection. Name files `native.json`, `sync.json` and `frame-locked.json` so they cannot be confused.

The source video is supposed to advance much more slowly in frame-locked mode. Verify that the video is truly paused while inference is pending, that boxes are drawn over the current—not an older—frame, that user seeking and switching sources cancel the hold, that a worker failure does not create an endless pause, and that turning frame-lock off restores normal speed. Verify that **Inspect frame** still works separately when manually paused.

## Scoring

Use independently annotated boxes/IDs at exact video media timestamps, not pseudo-labels. The browser trace evaluator only scores labeled timestamps present in **all** compared runs, so it reports sample coverage. If no timestamps overlap, collect denser traces or annotate observed timestamps rather than changing the timestamp to improve a score.

```powershell
node scripts/evaluate_live_trace.mjs --roi-min-y 320 docs/qa/final/highway-continuous-labels.json .bench/native.json .bench/sync.json .bench/frame-locked.json
```

Repeat on KITTI street, overhead, motorcycles, occlusion, and night scenes with their corresponding labels. Do not infer accuracy from a smooth-looking overlay. Record precision, recall, F1, mean IoU, source age, inference throughput, playback FPS, duplicate tracks, and ID switches for every trial. Compare coverage and false positives, not only recall.

**Release gate:** Frame-lock counts as a verified fix to continuous-overlay quality only if matched, independently labeled comparisons show improvement without unacceptable false positives, ghost boxes, ID churn, or inability to finish a clip. CI and pure unit tests do not satisfy this gate.

## Device and deployment

Run this protocol on the actual Surface Laptop 7 with native ARM64 Edge, first in WASM mode and then in automatic provider mode. Record `edge://gpu` adapter identity and Task Manager GPU use; a WebGPU session string alone does not establish hardware acceleration. For long clips, record real processing duration and memory at 5 and 30 minutes.

Do not merge the parent detector/storage PR into production solely because frame-locking works. The coordinated database migration and Edge Function rollout, private archive playback and B2 permissions, production OAuth/recovery, and Cloudflare managed build failure remain independent release gates.
