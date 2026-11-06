#!/usr/bin/env python3
"""Validate the exact fixed-shape YOLO11n ONNX contract used by VisionGuard.

This is a structural check, not a detection-accuracy or licensing guarantee.
Both the React postprocessor and Python backend expect FLOAT32 input
[1, 3, 640, 640] and an un-NMS'd FLOAT32 output [1, 84, 8400] using COCO80.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = ROOT / "apps" / "web" / "public" / "models" / "yolo11n.onnx"
EXPECTED_INPUT = (1, 3, 640, 640)
EXPECTED_OUTPUT = (1, 84, 8400)
REQUIRED_NAMES = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}


class ModelValidationError(ValueError):
    pass


def _shape(value: Any) -> tuple[int | None, ...]:
    dims = value.type.tensor_type.shape.dim
    return tuple(int(d.dim_value) if d.HasField("dim_value") else None for d in dims)


def _names(metadata: str) -> dict[int, str]:
    try:
        parsed = ast.literal_eval(metadata)
    except (SyntaxError, ValueError) as exc:
        raise ModelValidationError("Model 'names' metadata is not a literal COCO class mapping") from exc
    if isinstance(parsed, (list, tuple)):
        parsed = dict(enumerate(parsed))
    if not isinstance(parsed, dict):
        raise ModelValidationError("Model 'names' metadata must be an index-to-name map")
    try:
        return {int(k): str(v) for k, v in parsed.items()}
    except (TypeError, ValueError) as exc:
        raise ModelValidationError("Invalid class index in ONNX names metadata") from exc


def validate_model(model_path: Path, *, allow_missing_names: bool = False) -> dict[str, Any]:
    path = Path(model_path).expanduser().resolve()
    if not path.is_file():
        raise ModelValidationError(
            f"ONNX model not found: {path}. Run the export workflow or copy a compatible model."
        )
    if path.stat().st_size == 0:
        raise ModelValidationError("ONNX model file is empty")
    with path.open("rb") as file:
        first_bytes = file.read(256).lstrip().lower()
    if first_bytes.startswith((b"<!doctype", b"<html", b"<?xml")):
        raise ModelValidationError("Model path contains an HTML/XML response, not an ONNX model")

    try:
        import onnx
    except ImportError as exc:
        raise ModelValidationError('Install validation dependencies: pip install "onnx>=1.16,<2"') from exc

    try:
        model = onnx.load(str(path), load_external_data=False)
        onnx.checker.check_model(model)
    except Exception as exc:
        raise ModelValidationError(f"Invalid ONNX file or graph: {exc}") from exc

    external = [
        initializer.name for initializer in model.graph.initializer
        if initializer.data_location == onnx.TensorProto.EXTERNAL
    ]
    if external:
        raise ModelValidationError(
            "Model uses external weight files; export single-file ONNX (external tensors: "
            + ", ".join(external[:4]) + ")"
        )

    inputs = [i for i in model.graph.input if i.name not in {
        initializer.name for initializer in model.graph.initializer
    }]
    outputs = list(model.graph.output)
    if len(inputs) != 1 or len(outputs) != 1:
        raise ModelValidationError(
            f"Expected one image input and one raw output, found {len(inputs)} inputs / {len(outputs)} outputs"
        )
    if inputs[0].type.tensor_type.elem_type != onnx.TensorProto.FLOAT:
        raise ModelValidationError("Image input must be FLOAT32, not quantized or FLOAT16")
    if outputs[0].type.tensor_type.elem_type != onnx.TensorProto.FLOAT:
        raise ModelValidationError("Raw output must be FLOAT32")
    if _shape(inputs[0]) != EXPECTED_INPUT:
        raise ModelValidationError(
            f"Wrong input shape: {_shape(inputs[0])}; expected {EXPECTED_INPUT} (no dynamic export)"
        )
    if _shape(outputs[0]) != EXPECTED_OUTPUT:
        raise ModelValidationError(
            f"Wrong output shape: {_shape(outputs[0])}; expected {EXPECTED_OUTPUT} "
            "(80 COCO classes, no built-in NMS)"
        )
    if any(node.op_type == "NonMaxSuppression" for node in model.graph.node):
        raise ModelValidationError("Export must use nms=False; application performs its own NMS")

    props = {p.key: p.value for p in model.metadata_props}
    names = props.get("names")
    if not names and not allow_missing_names:
        raise ModelValidationError(
            "Missing COCO class-name metadata. Refusing an unverified class mapping. "
            "Use --allow-missing-names only after manually confirming all COCO80 indices."
        )
    if names:
        mapping = _names(names)
        if len(mapping) != 80 or set(mapping) != set(range(80)):
            raise ModelValidationError("Model is not labeled with exactly the expected 80 COCO class IDs")
        for class_id, expected in REQUIRED_NAMES.items():
            if mapping[class_id].strip().lower() != expected:
                raise ModelValidationError(
                    f"COCO class {class_id} must be '{expected}', got '{mapping[class_id]}'"
                )

    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return {
        "ok": True,
        "file": str(path),
        "size_bytes": path.stat().st_size,
        "sha256": digest.hexdigest(),
        "input_shape": list(EXPECTED_INPUT),
        "output_shape": list(EXPECTED_OUTPUT),
        "class_metadata_checked": bool(names),
        "opset": max((op.version for op in model.opset_import if not op.domain), default=None),
        "note": "Shape/metadata validated; inference quality and licensing require separate verification.",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--allow-missing-names", action="store_true")
    parser.add_argument("--json", action="store_true", help="Print machine-readable report")
    args = parser.parse_args(argv)
    try:
        report = validate_model(args.model, allow_missing_names=args.allow_missing_names)
    except ModelValidationError as exc:
        if args.json:
            print(json.dumps({"ok": False, "error": str(exc)}))
        else:
            print(f"MODEL NOT READY: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2) if args.json else
          f"MODEL READY: {report['file']} | SHA-256: {report['sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
