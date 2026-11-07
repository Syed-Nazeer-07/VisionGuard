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

After placing the file, restart Vite. The active analysis screen reports
whether WebGPU or WASM was selected and why it fell back.

## Optional local Python backend

The separate FastAPI backend uses its configured ONNX model path; its
sample configuration references `yolo11n.onnx`, not the frontend's
larger `yolo11s.onnx`. The repository retains the manual
`.github/workflows/export-onnx-model.yml` export workflow and Python
validation scripts for the nano variant.

Do not substitute an exported model file without checking the compatible
detector postprocessing, class order and input/output tensor shapes.

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
