#!/usr/bin/env python3
"""Export a single-file static YOLO11n ONNX model for VisionGuard.

Run on a compatible x64 Python environment or use the explicitly-triggered
GitHub Actions export workflow. No model weights are committed to Git.
Upstream pretrained weights have their own license terms; review before use.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

if __package__:
    from .validate_yolo_onnx import DEFAULT_MODEL, ModelValidationError, validate_model
else:
    from validate_yolo_onnx import DEFAULT_MODEL, ModelValidationError, validate_model


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", default="yolo11n.pt",
                        help="Existing local Ultralytics YOLO11n .pt weights (default: yolo11n.pt)")
    parser.add_argument("--output", type=Path, default=DEFAULT_MODEL,
                        help="Output ONNX file used by both web and Python backends")
    parser.add_argument("--download-upstream", action="store_true",
                        help="Allow Ultralytics to fetch upstream yolo11n.pt if missing")
    parser.add_argument("--acknowledge-license", action="store_true",
                        help="Confirm you reviewed upstream Ultralytics model and code licensing")
    args = parser.parse_args(argv)

    if not args.acknowledge_license:
        parser.error("Review upstream YOLO11n and Ultralytics license terms, then pass --acknowledge-license")
    weights = Path(args.weights).expanduser()
    if weights.suffix.lower() != ".pt":
        parser.error("Provide a compatible .pt checkpoint; the exporter produces the .onnx file")
    if not weights.is_file() and not (
        args.download_upstream and args.weights == "yolo11n.pt"
    ):
        parser.error(
            "Weights file is missing. Supply --weights /path/to/yolo11n.pt, "
            "or explicitly use --download-upstream to fetch official YOLO11n weights."
        )
    if args.output.suffix.lower() != ".onnx":
        parser.error("--output must be an .onnx file")

    try:
        from ultralytics import YOLO
    except ImportError as exc:
        print('Install exporter dependencies: pip install "ultralytics>=8.3,<9" "onnx>=1.16,<2"', file=sys.stderr)
        raise SystemExit(2) from exc

    # The model exporter creates a static FLOAT32 640x640 graph without
    # in-graph NMS. The app's own postprocessor expects (1, 84, 8400).
    model = YOLO(str(weights))
    exported = Path(model.export(
        format="onnx", imgsz=640, batch=1, dynamic=False, half=False,
        nms=False, opset=17, simplify=False
    )).resolve()
    try:
        report = validate_model(exported)
    except ModelValidationError as exc:
        print(f"Export failed the VisionGuard model contract: {exc}", file=sys.stderr)
        return 2

    target = args.output.expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    if exported != target:
        shutil.copy2(exported, target)
    report = validate_model(target)
    print(json.dumps({
        **report,
        "next": (
            "The model file is excluded from Git. Deploy this binary at "
            "/models/yolo11n.onnx alongside the built frontend; "
            "the Python backend reads it from the same directory by default."
        ),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
