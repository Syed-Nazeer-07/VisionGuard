"""Provenance regression: model-generated boxes must not be sold as ground truth."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "eval" / "dataset" / "ground_truth.json"
RESULTS = ROOT / "eval" / "benchmark_results.json"

def test_legacy_annotations_are_explicitly_pseudo_labels():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    assert data["human_verified"] is False
    assert data["annotation_origin"] == "automatic_model_pseudo_labels"
    assert data["frames"]
    assert all(frame.get("verified") is False for frame in data["frames"].values())
    assert all(box.get("verified") is False for frame in data["frames"].values()
               for box in frame["boxes"])

def test_historical_results_are_not_cited_as_real_detection_accuracy():
    data = json.loads(RESULTS.read_text(encoding="utf-8"))
    assert data["dataset_info"]["human_verified"] is False
    assert "pseudo" in data["dataset_info"]["annotation_origin"]
    report = (ROOT / "eval" / "BENCHMARK_REPORT.md").read_text(encoding="utf-8")
    assert "NOT ground-truth" in report
    assert "browser YOLO11s" in report
