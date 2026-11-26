# Browser tracking quality evaluation

This is a reproducible **quality gate**, not a claim that VisionGuard is
already accurate enough for traffic enforcement. The deployed browser runs
**YOLO11s**; the older backend report uses **YOLO11n** and must never be
presented as browser YOLO11s accuracy.

## Capture a real browser overlay trace (opt-in)

1. Visit your deployed VisionGuard Live Analysis URL with
   ?quality=1 appended to the path. For the current deployment:

   https://visionguard.syednazeerofficial2007.workers.dev/app/analyze?quality=1

2. Select a *local, permitted* traffic video using Choose video.
3. Play it. The trace captures at most 1200 sampled source-media frames at
   about 0.1 seconds apart, including frames with no displayed boxes.
   These are the **actual on-screen tracking IDs, classes and boxes**, in
   source-video pixel coordinates. No video pixels or footage are stored
   in the trace.
4. Click **Download QA trace (N)** at the top. This control is only visible
   while quality=1 is present and there are captured frames. Normal users
   never see the diagnostic control.
5. The exported JSON explicitly marks groundTruth and exitedIds as
   **null/unannotated**. It is not a benchmark and the evaluator intentionally
   refuses to score it until you supply honest manual annotations.

Seeking, changing the source, reconnecting or toggling box visibility resets
the trace because frame times or display conditions would otherwise be inconsistent.
Keep boxes enabled during a complete sample; disabled overlays are not empty
detector frames. Recorded footage supports slower review playback (0.25×, 0.5×,
0.75×, 1× normal), giving slower hardware more wall-clock processing time per
media second. The quality export records the actual playback rate; changing
rate resets the sample. Compare runs at identical rates when assessing a
model or tracking change, and report real-time and slowed review separately. Quality capture is in memory only; it neither uploads recordings
nor syncs its trace to Supabase.

The optional diagnostic export also includes bounded worker inference samples
and p50/p95 timing summaries for worker latency, result age relative to the
displayed video, and rendered overlay age. Replay-anchor misses distinguish
late inference from a successfully replayed observation. Empty timing samples
are reported as null, not zero; these are captured browser measurements, not
hardware benchmarks or a substitute for independently labeled accuracy. Retain
the same device, viewport, source clip, and display conditions when comparing runs.

## Label actual ground truth

Use the original video and the corresponding media times from the trace to
annotate each sampled frame independently. Fill in the groundTruth array with
actual vehicles present in the image, using:

~~~json
{
  "id": "vehicle-A",
  "className": "car",
  "box": { "x": 100, "y": 140, "w": 50, "h": 30 }
}
~~~

- Coordinates are center x/y and width/height in **original video pixels**.
- Human ground-truth IDs are continuous across frames, separate from the
  browser's prediction IDs.
- Do not copy the browser's predicted boxes into ground truth; that makes a
  meaningless perfect score.
- Replace exitedIds with an array of human-ground-truth IDs that first
  become completely absent because they **left the scene** on that frame.
  Do not mark ordinary occlusion as an exit.
- Include even frames with zero ground-truth objects. Keep the existing
  predictions untouched.
- Ensure all frames have increasing time and a positive width and height.

The labelled JSON must have format "visionguard-tracking-eval/v1", frames
with groundTruth and predictions arrays, and exitedIds arrays (optional for
frames that are not annotated for exits). There is an artificial example in
scripts/fixtures/tracking-synthetic.json which tests the evaluator and **is
not a real video model benchmark**.

## Generate the scoring report

From the repository root, after checking out the latest main:

~~~bash
npm run test:tracking-eval
node scripts/evaluate-tracking.mjs /path/to/labelled-browser-trace.json
~~~

The evaluator produces class-aware precision, recall, F1 and mean box IoU
at IoU@0.50 using maximum-cardinality class-aware one-to-one matching (not a global IoU optimizer); it also reports duplicate boxes, duplicate-ID frames, tracking ID switches
(across annotated observations no more than 0.5s apart) and how many
sampled frames a predicted ID lingered after a human-marked exit.

Optionally fail a release against *your documented acceptance thresholds*:

~~~bash
node scripts/evaluate-tracking.mjs /path/to/labelled-browser-trace.json --min-precision=0.8 --min-recall=0.7 --max-id-switches=2 --max-ghost-frames=0
~~~

These thresholds are suggested examples, **not measured achievements**.
The tool exits nonzero if a requested threshold is not met.

## Compare two revisions on matched evidence

Use the same permitted video and exact source-media frame times for both revisions.
Copy only the independently created human annotations to the corresponding
candidate frames; never alter predicted boxes. The comparison rejects mismatched
times, frame dimensions, ground-truth geometry, class labels and exit annotations.
It does not infer video identity from pixels; retain source checksums and run
metadata separately. If the capture times differ, reacquire matched frames
rather than silently dropping difficult frames.

~~~bash
node scripts/evaluate-tracking.mjs baseline.json --compare=candidate.json --min-f1=0.75 --min-mean-matched-iou=0.7 --max-duplicate-id-frames=0
~~~

The output includes both scorecards and candidate-minus-baseline deltas.
Thresholds apply to the candidate. These are illustrative thresholds, not
achieved model results. Higher precision/recall/F1 and mean IoU are better;
lower ID switches, duplicate predictions and ghost metrics are better.
Re-score the baseline using the new matching policy rather than comparing
the revised score with old greedy-matcher results.

## Real-world validation plan for a 9/10 portfolio project

Use multiple consented or properly licensed videos: at least 5 independent
scenes covering congestion, small motorcycles, heavy vehicles, occlusion,
night/low-light, and exits. Set aside an unseen holdout. Document the
labelled ground truth and prediction capture conditions.

Measure:
- Detection precision, recall and F1 separately for car, truck, bus, and
  motorcycle, and include performance on small distant vehicles.
- Tracking IDs, identity switches and duplicate boxes across video frames.
- Annotations for scene exits and the maximum time ghost boxes remain.
- Inference p50/p95 and throughput on real Chromium devices, including
  the Surface Laptop 7 and a modest CPU/WASM device.
- Event-level false positives and false negatives against labelled
  **review-worthy observations**. These are not traffic-law violations.

A historical Python YOLO11n report from October 13, 2026, which remains
recoverable in Git history, evaluated 119 frames (1,787 automatically
generated pseudo-labels) from one highway video at 640 × 640. It reported
72.15% precision and 62.34% recall against those pseudo-labels at
IoU 0.50. **The reference labels were themselves generated by a detector
and heuristics, not independently verified by human annotators.** These
numbers measure agreement with pseudo-labels, not real-world accuracy.
The model and execution pipeline also differ from browser YOLO11s.
Do not use this historical result in place of the real-world evaluation above.

Do not claim crash detection, red-light enforcement, or legally calibrated
speed measurements without the corresponding model, data and validation.

See the [overhaul verification](VISIONGUARD_OVERHAUL_QA.md) for model validation,
paired browser excerpts, runtime measurements, and remaining release gates.
