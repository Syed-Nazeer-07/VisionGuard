"""
VisionGuard Phase 2.2 — 4-Way Evaluation Suite
Evaluates all 4 production combinations:
1. Full Detection + Balanced
2. Full Detection + High Recall
3. Fast Processing + Balanced
4. Fast Processing + High Recall

Measures:
- Video stream throughput (FPS), decode time, detect time, tracking time
- Ground truth detection metrics (Precision, Recall, F1 @ IoU 0.50, Mean Box IoU, TP, FP, FN)
- Tracking ID consistency and unique track counts
- Nearest-frame playback accuracy trade-offs
"""

import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Any
import cv2
import numpy as np

# Ensure backend root is on sys.path
BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.pipeline.detector import YOLODetector
from app.pipeline.tracker import ByteTracker
from eval.evaluator import DetectionEvaluator

DATASET_DIR = BACKEND_ROOT / "eval" / "dataset"
GROUND_TRUTH_PATH = DATASET_DIR / "ground_truth.json"
IMAGES_DIR = DATASET_DIR / "images"
VIDEO_PATH = BACKEND_ROOT.parent / "assets" / "car-detection.mp4"

TARGET_CLASSES = ["car", "truck", "bus", "motorcycle"]

def evaluate_video_stream(
    detector: YOLODetector,
    video_path: Path,
    num_frames: int = 300,
    conf_th: float = 0.20,
    iou_th: float = 0.45,
    stride: int = 1
) -> Dict[str, Any]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    tracker = ByteTracker()
    decode_times = []
    detect_times = []
    track_times = []
    unique_tracks = set()
    processed_count = 0
    max_active_tracks = 0

    t_start = time.perf_counter()
    for frame_idx in range(1, num_frames + 1):
        t0 = time.perf_counter()
        if stride > 1 and ((frame_idx - 1) % stride != 0):
            if not cap.grab():
                break
            t1 = time.perf_counter()
            decode_times.append(t1 - t0)
            continue

        ret, frame = cap.read()
        if not ret:
            break
        t1 = time.perf_counter()
        decode_times.append(t1 - t0)
        processed_count += 1

        t0 = time.perf_counter()
        raw_boxes = detector.detect(frame, conf_threshold=conf_th, iou_threshold=iou_th)
        t1 = time.perf_counter()
        detect_times.append(t1 - t0)

        t0 = time.perf_counter()
        tracks = tracker.update(raw_boxes)
        for t in tracks:
            unique_tracks.add(t["track_id"])
        max_active_tracks = max(max_active_tracks, len(tracks))
        t1 = time.perf_counter()
        track_times.append(t1 - t0)

    t_end = time.perf_counter()
    cap.release()
    total_elapsed = t_end - t_start
    video_fps = num_frames / total_elapsed if total_elapsed > 0 else 0.0

    return {
        "num_video_frames": num_frames,
        "processed_frames": processed_count,
        "total_elapsed_s": round(total_elapsed, 3),
        "effective_video_fps": round(video_fps, 2),
        "inference_fps": round(processed_count / (sum(detect_times) or 1e-6), 2),
        "decode_time_s": round(sum(decode_times), 3),
        "detect_time_s": round(sum(detect_times), 3),
        "track_time_s": round(sum(track_times), 3),
        "unique_tracks": len(unique_tracks),
        "max_active_tracks": max_active_tracks
    }

def evaluate_ground_truth(
    detector: YOLODetector,
    evaluator: DetectionEvaluator,
    gt_dict: Dict[str, Any],
    sample_list: List[Dict[str, Any]],
    conf_th: float,
    iou_th: float,
    stride: int = 1
) -> Dict[str, Any]:
    preds: Dict[str, List[Dict[str, Any]]] = {}
    tracker = ByteTracker()
    total_tracks_created = 0

    # Filter samples if stride > 1
    eval_samples = sample_list if stride == 1 else [s for i, s in enumerate(sample_list) if i % stride == 0]
    eval_gt_dict = {s["sample_id"]: gt_dict[s["sample_id"]] for s in eval_samples}

    t0 = time.perf_counter()
    for s in eval_samples:
        img_path = IMAGES_DIR / s["image_filename"]
        frame = cv2.imread(str(img_path))
        raw_dets = detector.detect(frame, conf_threshold=conf_th, iou_threshold=iou_th)

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
    eval_res = evaluator.evaluate_dataset(eval_gt_dict, preds, box_format_gt="xywh", box_format_pred="cxcywh")
    m50 = eval_res["metrics"]["iou_50"]
    m75 = eval_res["metrics"]["iou_75"]

    return {
        "evaluated_frames": len(eval_samples),
        "m50": m50,
        "m75": m75,
        "box_iou_stats": eval_res.get("box_iou_stats", {}),
        "total_tracks": total_tracks_created
    }

def main():
    print("=" * 80)
    print(" VisionGuard Phase 2.2 — Comprehensive 4-Way Evaluation Suite")
    print("=" * 80)

    gt_data = json.load(open(GROUND_TRUTH_PATH, "r", encoding="utf-8"))
    gt_dict = {
        sid: [{"box": b["box"], "class": b["class_name"].lower()} for b in f["boxes"]]
        for sid, f in gt_data["frames"].items()
    }
    sample_list = [
        {"sample_id": sid, "image_filename": f["image_filename"]}
        for sid, f in gt_data["frames"].items()
    ]

    detector = YOLODetector()
    evaluator = DetectionEvaluator(iou_thresholds=[0.50, 0.75], target_classes=TARGET_CLASSES)

    # Warmup
    dummy = np.zeros((1080, 1920, 3), dtype=np.uint8)
    for _ in range(5):
        detector.detect(dummy)

    print(f"Detector Active Provider: {detector.active_provider}")
    print(f"Ground Truth Dataset: {len(sample_list)} verified frames, {sum(len(b) for b in gt_dict.values())} vehicle boxes.\n")

    matrix = [
        {
            "name": "Full Detection + Balanced",
            "speed": "Full (stride 1)",
            "profile": "Balanced",
            "stride": 1,
            "conf": 0.20,
            "iou": 0.45
        },
        {
            "name": "Full Detection + High Recall",
            "speed": "Full (stride 1)",
            "profile": "High Recall",
            "stride": 1,
            "conf": 0.15,
            "iou": 0.45
        },
        {
            "name": "Fast Processing + Balanced",
            "speed": "Fast (stride 2)",
            "profile": "Balanced",
            "stride": 2,
            "conf": 0.20,
            "iou": 0.45
        },
        {
            "name": "Fast Processing + High Recall",
            "speed": "Fast (stride 2)",
            "profile": "High Recall",
            "stride": 2,
            "conf": 0.15,
            "iou": 0.45
        }
    ]

    results = []
    for cfg in matrix:
        print(f"--- Running: {cfg['name']} ---")
        # 1. Video stream benchmark
        v_res = evaluate_video_stream(
            detector=detector,
            video_path=VIDEO_PATH,
            num_frames=300,
            conf_th=cfg["conf"],
            iou_th=cfg["iou"],
            stride=cfg["stride"]
        )
        print(f"  Video Stream (300 frames): {v_res['total_elapsed_s']}s => {v_res['effective_video_fps']} FPS (Inference: {v_res['inference_fps']} FPS, Tracks: {v_res['unique_tracks']})")

        # 2. Ground truth accuracy benchmark
        gt_res = evaluate_ground_truth(
            detector=detector,
            evaluator=evaluator,
            gt_dict=gt_dict,
            sample_list=sample_list,
            conf_th=cfg["conf"],
            iou_th=cfg["iou"],
            stride=cfg["stride"]
        )
        ov = gt_res["m50"]["overall"]
        print(f"  GT Evaluation ({gt_res['evaluated_frames']} frames): Precision={ov['precision']*100:.2f}%, Recall={ov['recall']*100:.2f}%, F1={ov['f1']*100:.2f}%, TP={ov['tp']}, FP={ov['fp']}, FN={ov['fn']}")

        results.append({
            "config": cfg,
            "video_stream": v_res,
            "ground_truth": gt_res
        })

    # Save results to json
    out_file = BACKEND_ROOT / "eval" / "phase2_2_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print("\n" + "=" * 80)
    print(" SUMMARY COMPARISON TABLE")
    print("=" * 80)
    print(f"{'Mode':<30} | {'Throughput':<10} | {'Prec @.50':<10} | {'Recall @.50':<11} | {'F1 @.50':<8} | {'Tracks':<6}")
    print("-" * 80)
    for r in results:
        cfg = r["config"]
        v = r["video_stream"]
        ov = r["ground_truth"]["m50"]["overall"]
        print(f"{cfg['name']:<30} | {v['effective_video_fps']:>7.1f} FPS | {ov['precision']*100:>8.2f}% | {ov['recall']*100:>9.2f}% | {ov['f1']*100:>6.2f}% | {v['unique_tracks']:>6}")
    print("=" * 80)

if __name__ == "__main__":
    main()
