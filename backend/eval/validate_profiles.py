"""
VisionGuard Phase 2.1 — Profile Validation Suite
Evaluates both production profiles against the 119-frame ground-truth dataset:
- Profile 1: Balanced (conf=0.20, iou=0.45)
- Profile 2: High Recall (conf=0.15, iou=0.45)
Reports precision, recall, F1, box IoU distribution, TP, FP, FN, duplicates,
per-class metrics, throughput (FPS), and verifies tracker integration.
"""

import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Any
import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.pipeline.detector import YOLODetector
from app.pipeline.tracker import ByteTracker
from eval.evaluator import DetectionEvaluator

DATASET_DIR = Path("backend/eval/dataset").resolve()
GROUND_TRUTH_PATH = DATASET_DIR / "ground_truth.json"
IMAGES_DIR = DATASET_DIR / "images"

TARGET_CLASSES = ["car", "truck", "bus", "motorcycle"]

def evaluate_profile(det: YOLODetector, evaluator: DetectionEvaluator, gt_dict: Dict[str, Any], samples: List[Dict[str, Any]], conf: float, iou: float, profile_name: str):
    preds: Dict[str, List[Dict[str, Any]]] = {}
    tracker = ByteTracker()
    total_tracks_created = 0

    t0 = time.perf_counter()
    for s in samples:
        img_path = IMAGES_DIR / s["image_filename"]
        frame = cv2.imread(str(img_path))
        raw_dets = det.detect(frame, conf_threshold=conf, iou_threshold=iou)

        # Verify tracker ingestion
        tracks = tracker.update(raw_dets)
        total_tracks_created += len(tracks)

        preds[s["sample_id"]] = [
            {
                "box": (d.cx, d.cy, d.w, d.h),
                "class": d.class_name.lower(),
                "score": d.prob
            }
            for d in raw_dets
            if d.class_name.lower() in TARGET_CLASSES
        ]

    elapsed = time.perf_counter() - t0
    fps = len(samples) / elapsed if elapsed > 0 else 0

    eval_res = evaluator.evaluate_dataset(gt_dict, preds, box_format_gt="xywh", box_format_pred="cxcywh")
    m50 = eval_res["metrics"]["iou_50"]
    m75 = eval_res["metrics"]["iou_75"]

    return {
        "profile": profile_name,
        "conf": conf,
        "iou": iou,
        "elapsed_seconds": round(elapsed, 2),
        "fps": round(fps, 2),
        "m50": m50,
        "m75": m75,
        "total_tracks_evaluated": total_tracks_created
    }

def main():
    print("=" * 70)
    print(" VisionGuard Detection Profile Validation")
    print("=" * 70)

    gt_data = json.load(open(GROUND_TRUTH_PATH, "r", encoding="utf-8"))
    gt_dict = {
        sid: [{"box": b["box"], "class": b["class_name"].lower()} for b in f["boxes"]]
        for sid, f in gt_data["frames"].items()
    }
    samples = [
        {"sample_id": sid, "image_filename": f["image_filename"]}
        for sid, f in gt_data["frames"].items()
    ]

    det = YOLODetector()
    evaluator = DetectionEvaluator(iou_thresholds=[0.50, 0.75], target_classes=TARGET_CLASSES)
    print(f"Loaded YOLO detector on provider: {det.active_provider}")
    print(f"Dataset: {len(samples)} frames, {sum(len(b) for b in gt_dict.values())} vehicle annotations.\n")

    print("Evaluating Profile 1: Balanced (conf=0.20, iou=0.45)...")
    res_bal = evaluate_profile(det, evaluator, gt_dict, samples, conf=0.20, iou=0.45, profile_name="Balanced")

    print("Evaluating Profile 2: High Recall (conf=0.15, iou=0.45)...")
    res_hr = evaluate_profile(det, evaluator, gt_dict, samples, conf=0.15, iou=0.45, profile_name="High Recall")

    # Side-by-side comparison table
    b50 = res_bal["m50"]["overall"]
    h50 = res_hr["m50"]["overall"]
    b_iou = res_bal["m50"]["iou_distribution"]
    h_iou = res_hr["m50"]["iou_distribution"]

    print("\n" + "=" * 70)
    print(f"{'Metric':<30} | {'Balanced (0.20 conf)':<18} | {'High Recall (0.15 conf)':<18}")
    print("-" * 70)
    print(f"{'Precision (@ IoU 0.50)':<30} | {b50['precision']*100:>17.2f}% | {h50['precision']*100:>17.2f}%")
    print(f"{'Recall (@ IoU 0.50)':<30} | {b50['recall']*100:>17.2f}% | {h50['recall']*100:>17.2f}%")
    print(f"{'F1 Score (@ IoU 0.50)':<30} | {b50['f1']*100:>17.2f}% | {h50['f1']*100:>17.2f}%")
    print(f"{'True Positives (TP)':<30} | {b50['tp']:>18} | {h50['tp']:>18}")
    print(f"{'False Positives (FP)':<30} | {b50['fp']:>18} | {h50['fp']:>18}")
    print(f"{'False Negatives (FN)':<30} | {b50['fn']:>18} | {h50['fn']:>18}")
    print(f"{'Duplicate Detections':<30} | {b50['duplicate_detections']:>18} | {h50['duplicate_detections']:>18}")
    print(f"{'Mean Box IoU (Matched)':<30} | {b_iou['mean']:>18.4f} | {h_iou['mean']:>18.4f}")
    print(f"{'Median Box IoU (Matched)':<30} | {b_iou['median']:>18.4f} | {h_iou['median']:>18.4f}")
    print(f"{'Processing Throughput':<30} | {res_bal['fps']:>14.2f} FPS | {res_hr['fps']:>14.2f} FPS")
    print("=" * 70)

    print("\n--- Per-Class Metrics ---")
    for c in TARGET_CLASSES:
        bc = res_bal["m50"]["per_class"][c]
        hc = res_hr["m50"]["per_class"][c]
        print(f"Class: {c.upper()}")
        print(f"  Balanced:    P={bc['precision']*100:.1f}%, R={bc['recall']*100:.1f}%, F1={bc['f1']*100:.1f}%, TP={bc['tp']}, FP={bc['fp']}, FN={bc['fn']}")
        print(f"  High Recall: P={hc['precision']*100:.1f}%, R={hc['recall']*100:.1f}%, F1={hc['f1']*100:.1f}%, TP={hc['tp']}, FP={hc['fp']}, FN={hc['fn']}")

    print("\n--- Size Breakdown ---")
    for s_cat in ["small", "medium", "large"]:
        bs = res_bal["m50"]["per_size"][s_cat]
        hs = res_hr["m50"]["per_size"][s_cat]
        print(f"Size: {s_cat.upper()}")
        print(f"  Balanced:    P={bs['precision']*100:.1f}%, R={bs['recall']*100:.1f}%, F1={bs['f1']*100:.1f}%, TP={bs['tp']}, FP={bs['fp']}, FN={bs['fn']}")
        print(f"  High Recall: P={hs['precision']*100:.1f}%, R={hs['recall']*100:.1f}%, F1={hs['f1']*100:.1f}%, TP={hs['tp']}, FP={hs['fp']}, FN={hs['fn']}")

if __name__ == "__main__":
    main()
