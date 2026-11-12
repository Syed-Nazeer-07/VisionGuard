# VisionGuard model setup

The repository does **not** include pre-trained ONNX weights. Model files
are ignored by Git to avoid accidental distribution and large commits.

## Browser Live Analysis

VisionGuard loads:

`apps/web/public/models/yolo11s.onnx`

Use an appropriately licensed and exported YOLO11s model compatible with
the frontend decoder's COCO classes and ONNX input/output shape. The
expected standard configuration is a fixed 640 × 640 RGB input with
`[1,84,8400]` output. Verify this contract with your specific export
rather than assuming every YOLO ONNX graph is identical.

Alternatively configure `VITE_YOLO_MODEL_URL` with a compatible public
HTTPS ONNX file (for Cloudflare, the hosted model currently lives at
`https://huggingface.co/SyedNazeer07/visionguard-yolo11s/resolve/main/yolo11s.onnx`).
Ensure HEAD/GET and redirects permit browser CORS.

After placing/configuring the file, restart Vite. The active analysis screen
reports whether WebGPU or WASM was selected and why it fell back. The
Cloudflare production build also uses a version-matched public jsDelivr
ONNX Runtime WASM asset to avoid Cloudflare's 25 MiB per-file limit.
That CDN is a runtime dependency and must be reachable for inference.

## Model export tools (build-time only)

The manual `.github/workflows/export-onnx-model.yml` workflow can export a
licensed YOLO11n/s/m ONNX model and validate it using Python. These are
**optional developer tools**, not a Python analysis server or runtime
requirement. Never assume a nano or medium model is interchangeable with
the browser YOLO11s tensor contract.

Before using another export, verify the detector postprocessing, class
order and exact input/output tensor shapes.

## Validation

- `npm run build` checks TypeScript/bundling; it does **not** load or test
  ONNX weights.
- `python scripts/validate_yolo_onnx.py` validates the supported graph
  shape on a compatible Python runtime.
- `python scripts/smoke_yolo_onnx.py` provides a smoke check for compatible
  exports; it is not an accuracy benchmark.
- Confirm recognition on representative road footage with independently
  labeled ground truth, especially motorcycles, buses and trucks.
- On Windows on ARM, verify actual WebGPU/WASM support rather than assuming
  native GPU execution. Some browsers use WASM emulation and may process
  far fewer than 30 inference frames per second.

Review Ultralytics model/software licensing before distributing weights or
deploying this application commercially.
