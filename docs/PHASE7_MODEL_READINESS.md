# Phase 7 — Model deployment and environment readiness

The repository intentionally excludes `*.onnx` and `*.pt` weights. The
browser application, the local FastAPI backend and Phase 6 HLS inference all
expect **one compatible YOLO11n ONNX model** at:

`apps/web/public/models/yolo11n.onnx`

A working React build **does not prove** that this model is present, executable,
accurate, legally usable or supported on the target hardware.

## Fastest reliable option: manual GitHub Actions export

This is particularly convenient when developing on **Windows on ARM**, where
PyTorch/Ultralytics export dependencies may not have suitable native builds.

1. Review the [Ultralytics licensing terms](https://www.ultralytics.com/license)
   and the pretrained model's license for your use case. Do not assume an
   exported ONNX file removes upstream licensing requirements.
2. After this workflow is merged onto the default GitHub branch, open
   **Actions → Export YOLO11n ONNX (manual, license acknowledgement required) →
   Run workflow**.
3. Set `accept_upstream_license = yes` **only if you agree to those terms**.
   The job downloads official `yolo11n.pt`, exports a static FP32 model
   without built-in NMS, checks its ONNX graph/COCO mapping, and runs a
   CPU ONNX Runtime smoke test.
4. Download the `visionguard-yolo11n-onnx` run artifact. The zip contains
   `apps/web/public/models/yolo11n.onnx` and `model-manifest.json`.
   Artifacts expire after 7 days. **The model is not committed to Git.**
5. Copy the ONNX file into your local
   `apps/web/public/models/yolo11n.onnx` directory (create it if needed).
6. Run the checks below before launching either analysis engine.

## Manual export with existing licensed weights

Use an environment with compatible PyTorch, Ultralytics and ONNX packages
(for example an x64 Linux host):

```bash
python -m pip install "ultralytics>=8.3,<9" "onnx>=1.16,<2" "onnxruntime>=1.20,<2"
python scripts/export_yolo11n.py --weights /path/to/yolo11n.pt --acknowledge-license
```

If explicitly authorized to obtain official upstream weights instead:

```bash
python scripts/export_yolo11n.py --weights yolo11n.pt --download-upstream --acknowledge-license
```

The exporter uses `format=onnx`, `imgsz=640`, `batch=1`,
`dynamic=False`, `half=False`, `nms=False`, `opset=17` and
`simplify=False`. Any incompatible output is rejected. Do not use an
end-to-end NMS export or a custom class taxonomy without changing the app's
postprocessing first.

## Validate locally before running VisionGuard

From the repository root:

```bash
python -m pip install "onnx>=1.16,<2" "onnxruntime>=1.20,<2" numpy
python scripts/validate_yolo_onnx.py --json
python scripts/smoke_yolo_onnx.py
python scripts/visionguard_doctor.py
```

After starting the local Python backend, run:

```bash
python scripts/visionguard_doctor.py --backend-check
```

The validator checks the exact input/output tensor contract and COCO
class-name metadata; the smoke tool executes a **blank frame on CPU** and
checks for finite, correctly shaped results. Neither tool measures actual
vehicle detection performance.

Expected model contract:

| Property | Required |
|---|---|
| ONNX input | `float32 [1,3,640,640]` |
| ONNX output | `float32 [1,84,8400]` |
| Class count | 80, standard COCO ordering |
| Important class IDs | person 0, bicycle 1, car 2, motorcycle 3, bus 5, truck 7 |
| Export features | static shape, no built-in NMS, no external weights |
| Model serving path | `/models/yolo11n.onnx` |
| Backend default path | `apps/web/public/models/yolo11n.onnx` |

The ONNX checker intentionally rejects absent COCO names unless an expert
opts into `--allow-missing-names`. This opt-out only suppresses a metadata
requirement; it **cannot establish class correctness** on its own.

## Configure the services

1. Run `npm ci` at the repository root (Node 22 is used in CI).
2. Create a root `.env` from `.env.example`. Configure
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for a **staging**
   Supabase project. Never add service-role secrets to `VITE_*` values.
3. Install backend requirements into a Python environment and start
   FastAPI on loopback only. The default model path is shared with web.
4. Run `npm run dev -w web` to start the frontend.
5. For production static hosting, place the ONNX file in
   `apps/web/public/models` **before** `npm run build`; Vite copies
   `public` assets into the build. Confirm `/models/yolo11n.onnx`
   returns the binary, **not** an HTML SPA fallback.
6. Test in both a supported browser's WebGPU and WASM modes. Importing a
   model into ONNX Runtime on CPU **does not** prove WebGPU support.

## Real-world acceptance tests still needed

- Feed at least 5–10 varied daylight/night, near/far, rain/clear, and
  moving/static vehicles through browser and Python modes. Review boxes,
  misses, false positives and class mapping.
- Record precision/recall, ID switches and processing FPS on actual videos.
  Existing benchmark results in `backend/eval` are historical and were not
  rerun by this phase.
- Test real camera HLS playback, manifest/segment CORS and the Phase 6
  live inference page with the exported model.
- Verify actual role/RLS permissions, stored video artifacts, history and
  incident review on **staging** before touching a live Supabase project.
- Validate camera calibration using independent ground truth. Estimated
  speeds must not automatically become legal penalties.

## Security / maintenance

- The manual export workflow runs only when a user explicitly acknowledges
  the upstream license. It never commits model weights to the repository.
- CI uses synthetic ONNX fixtures to verify contract guards, not trained
  model weights or live camera streams. Green CI is **not** a production
  acceptance test.
- `visionguard_doctor.py` reports whether Supabase variables are present,
  without printing their values. Its `--backend-check` accesses only
  `127.0.0.1:8000`.
- The separate Phase 1 security and Phase 3 tracking migrations are still
  staging-gated. Phase 7 does not apply database changes.
