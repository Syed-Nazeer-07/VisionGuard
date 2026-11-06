#!/usr/bin/env python3
"""VisionGuard environment doctor. No credentials are printed or uploaded.

With --ci, checks that are intentionally unavailable in source CI (model
weights, Supabase project, running local services) are SKIP instead of FAIL.
Without --ci, errors make startup requirements obvious to the operator.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from validate_yolo_onnx import DEFAULT_MODEL, ModelValidationError, validate_model

ROOT = Path(__file__).resolve().parents[1]


def _environment(path: Path) -> dict[str, str]:
    """Read env values only to check presence. Never output their contents."""
    if not path.is_file():
        return {}
    result: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def diagnose(root: Path = ROOT, *, ci: bool = False,
             model: Path | None = None, backend_check: bool = False) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    def add(name: str, status: str, detail: str) -> None:
        checks.append({"check": name, "status": status, "detail": detail})

    if (root / "apps/web/package.json").is_file() and (root / "backend/requirements.txt").is_file():
        add("repository", "PASS", "Frontend and Python backend project files exist")
    else:
        add("repository", "FAIL", "Expected apps/web/package.json and backend/requirements.txt")

    if shutil.which("node") and shutil.which("npm"):
        add("node", "PASS", "Node.js and npm on PATH")
    else:
        add("node", "SKIP" if ci else "FAIL", "Install Node.js and npm")

    node_modules = root / "node_modules"
    add("frontend dependencies",
        "PASS" if node_modules.is_dir() else ("SKIP" if ci else "FAIL"),
        "npm dependencies installed" if node_modules.is_dir() else "Run npm ci at the repository root")

    env = _environment(root / ".env")
    url = env.get("VITE_SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    anon = env.get("VITE_SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY", "")
    configured = bool(url.startswith("https://") and ".supabase.co" in url and len(anon) > 30)
    add("Supabase",
        "PASS" if configured else ("SKIP" if ci else "FAIL"),
        "Supabase URL and anon key configured (values hidden)" if configured else
        "Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in root .env; otherwise demo/mock mode may be used")

    chosen_model = model or (root / "apps/web/public/models/yolo11n.onnx")
    if ci and not chosen_model.is_file():
        add("YOLO ONNX", "SKIP", "Model weights intentionally excluded from repository; manual export required")
    else:
        try:
            report = validate_model(chosen_model)
        except ModelValidationError as exc:
            add("YOLO ONNX", "FAIL", str(exc))
        else:
            add("YOLO ONNX", "PASS",
                "Static 640x640 COCO80 contract validated, SHA256="
                + report["sha256"][:16] + "… (accuracy not validated)")

    if backend_check:
        # Deliberately fixed loopback URL: not an arbitrary remote URL fetcher.
        try:
            with urllib.request.urlopen(
                "http://127.0.0.1:8000/api/v1/health", timeout=2
            ) as response:
                data = json.load(response)
            if data.get("model_ready") is True:
                add("local backend", "PASS", "Backend health endpoint reports a loaded model")
            else:
                add("local backend", "FAIL", "Backend is reachable but model_ready is false")
        except (OSError, ValueError, urllib.error.URLError) as exc:
            add("local backend", "FAIL", f"Local FastAPI health unavailable: {type(exc).__name__}")
    else:
        add("local backend", "SKIP", "Use --backend-check after starting FastAPI")

    return checks


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ci", action="store_true", help="Skip external runtime prerequisites")
    parser.add_argument("--backend-check", action="store_true", help="Probe loopback-only FastAPI health")
    parser.add_argument("--model", type=Path, help="Explicit model path to validate")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    checks = diagnose(ci=args.ci, backend_check=args.backend_check, model=args.model)
    if args.json:
        print(json.dumps({"checks": checks, "ready": not any(c["status"] == "FAIL" for c in checks)}, indent=2))
    else:
        for check in checks:
            print(f"[{check['status']}] {check['check']}: {check['detail']}")
    return 2 if any(check["status"] == "FAIL" for check in checks) else 0


if __name__ == "__main__":
    raise SystemExit(main())
