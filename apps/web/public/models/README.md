# YOLO11n model directory

Place a compatible **licensed** `yolo11n.onnx` file here. It is intentionally
excluded from Git by `*.onnx` in the root `.gitignore`.

VisionGuard browser and Python analysis require one fixed-shape FP32
YOLO11n ONNX model with:

- Input: `[1, 3, 640, 640]`
- Output: `[1, 84, 8400]`
- 80 COCO class names and standard numeric IDs
- No dynamic shape, no in-graph NMS, no external weights

Run `python scripts/validate_yolo_onnx.py` from the repository root.
For instructions on creating and testing this file using GitHub Actions,
see [Phase 7 model readiness](../../../../docs/PHASE7_MODEL_READINESS.md).

**Important:** A real .onnx file must be present **before Vite production
build**. A README or placeholder does not constitute model installation.
