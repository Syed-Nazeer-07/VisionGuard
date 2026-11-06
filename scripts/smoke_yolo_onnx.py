#!/usr/bin/env python3
"""Load a compatible ONNX model through CPU ONNX Runtime and run one dry frame.

This checks executable input/output compatibility only. It does not measure
accuracy on traffic, track IDs, speed, FPS or browser WebGPU compatibility.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__:
    from .validate_yolo_onnx import DEFAULT_MODEL, ModelValidationError, validate_model
else:
    from validate_yolo_onnx import DEFAULT_MODEL, ModelValidationError, validate_model


def smoke(model: Path) -> dict[str, object]:
    structural = validate_model(model)
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError as exc:
        raise ModelValidationError("Install numpy and onnxruntime to run the CPU model smoke test") from exc

    try:
        session = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
        input_name = session.get_inputs()[0].name
        raw = session.run(None, {input_name: np.zeros((1, 3, 640, 640), dtype=np.float32)})
    except Exception as exc:
        raise ModelValidationError(f"ONNX Runtime could not execute the model: {exc}") from exc

    if len(raw) != 1 or raw[0].shape != (1, 84, 8400):
        raise ModelValidationError("Runtime returned a different output shape than VisionGuard expects")
    if raw[0].dtype != np.float32 or not np.isfinite(raw[0]).all():
        raise ModelValidationError("ONNX runtime output contains invalid or non-FLOAT32 values")

    return {
        "runtime_ok": True,
        "model_sha256": structural["sha256"],
        "execution_provider": session.get_providers()[0],
        "input_shape": [1, 3, 640, 640],
        "output_shape": [1, 84, 8400],
        "note": "Blank-frame execution succeeded. Real traffic accuracy remains unverified.",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    args = parser.parse_args(argv)
    try:
        result = smoke(args.model)
    except ModelValidationError as exc:
        print(f"MODEL RUNTIME NOT READY: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
