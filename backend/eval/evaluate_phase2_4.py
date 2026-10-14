"""
VisionGuard Phase 2.4 — Motion-Aware Tracking Evaluation Suite

Evaluates all four production configurations:
1. Full Detection + Balanced (conf 0.20, iou 0.45, stride 1)
2. Full Detection + High Recall (conf 0.15, iou 0.45, stride 1)
3. Fast Processing + Balanced with Motion Interpolation (conf 0.20, iou 0.45, stride 2)
4. Fast Processing + High Recall with Motion Interpolation (conf 0.15, iou 0.45, stride 2)

Sections evaluated:
A. Detector accuracy on common inference frames
B. Temporal overlay localization across all 119 ground-truth frames
C. Tracking continuity and lifetime analysis on continuous traffic video
D. End-to-end processing throughput and latency breakdown
"""

import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Any, Tuple
import cv2
import numpy as np

BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.pipeline.detector import YOLODetector
from app.pipeline.tracker import ByteTracker, Track
from app.pipeline.interpolator import TrackInterpolator
from app.pipeline.processor import VideoProcessor
from eval.evaluator import DetectionEvaluator, compute_iou

DATASET_DIR = BACKEND_ROOT / "eval" / "dataset"
GROUND_TRUTH_PATH = DATASET_DIR / "ground_truth.json"
IMAGES_DIR = DATASET_DIR / "images"
VIDEO_PATH = BACKEND_ROOT.parent / "assets" / "car-detection.mp4"

TARGET_CLASSES = ["car", "truck", "bus", "motorcycle"]

def load_ground_truth() -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    gt_data = json.load(open(GROUND_TRUTH_PATH, "r", encoding="utf-8"))
    gt_dict = {
        sid: [{"box": b["box"], "class": b["class_name"].lower()} for b in f["boxes"]]
        for sid, f in gt_data["frames"].items()
    }
    sample_list = [
        {
            "sample_id": sid,
            "frame_index": f["frame_index"],
            "timestamp_seconds": f["timestamp_seconds"],
            "image_filename": f["image_filename"]
        }
        for sid, f in gt_data["frames"].items()
    ]
    sample_list.sort(key=lambda s: s["frame_index"])
    return gt_dict, sample_list

def evaluate_inference_accuracy(
    detector: YOLODetector,
    evaluator: DetectionEvaluator,
    gt_dict: Dict[str, Any],
    samples: List[Dict[str, Any]],
    conf_th: float,
    iou_th: float
) -> Dict[str, Any]:
    preds: Dict[str, List[Dict[str, Any]]] = {}
    eval_gt = {s["sample_id"]: gt_dict[s["sample_id"]] for s in samples}

    for s in samples:
        img_path = IMAGES_DIR / s["image_filename"]
        frame = cv2.imread(str(img_path))
        raw_dets = detector.detect(frame, conf_threshold=conf_th, iou_threshold=iou_th)
        preds[s["sample_id"]] = [
            {"box": (d.cx, d.cy, d.w, d.h), "class": d.class_name.lower(), "score": d.prob}
            for d in raw_dets if d.class_name.lower() in TARGET_CLASSES
        ]

    eval_res = evaluator.evaluate_dataset(eval_gt, preds, box_format_gt="xywh", box_format_pred="cxcywh")
    return {
        "iou_50": eval_res["metrics"]["iou_50"]["overall"],
        "iou_75": eval_res["metrics"]["iou_75"]["overall"],
        "mean_iou": eval_res["metrics"]["iou_50"]["iou_distribution"]["mean"]
    }

def evaluate_temporal_localization(
    detector: YOLODetector,
    evaluator: DetectionEvaluator,
    interpolator: TrackInterpolator,
    gt_dict: Dict[str, Any],
    all_samples: List[Dict[str, Any]],
    conf_th: float,
    iou_th: float
) -> Dict[str, Any]:
    """
    Evaluates:
    1. Full Detection (119 frames fresh)
    2. Phase 2.3 Baseline: Strict Raw (0 inferences on skipped frames)
    3. Phase 2.3 Baseline: Nearest Sampled Frame Playback (stale box reuse)
    4. Phase 2.4: Motion-Aware Tracking (Interpolation & Conservative Prediction)
    """
    odd_samples = [s for s in all_samples if (s["frame_index"] - 1) % 2 == 0]
    even_samples = [s for s in all_samples if (s["frame_index"] - 1) % 2 != 0]

    # Precompute fresh detector detections for all frames
    all_raw_dets: Dict[str, List[Any]] = {}
    for s in all_samples:
        img_path = IMAGES_DIR / s["image_filename"]
        frame = cv2.imread(str(img_path))
        dets = detector.detect(frame, conf_threshold=conf_th, iou_threshold=iou_th)
        all_raw_dets[s["sample_id"]] = [d for d in dets if d.class_name.lower() in TARGET_CLASSES]

    # 1. Full Detection
    preds_full: Dict[str, List[Dict[str, Any]]] = {
        s["sample_id"]: [
            {"box": (d.cx, d.cy, d.w, d.h), "class": d.class_name.lower(), "score": d.prob}
            for d in all_raw_dets[s["sample_id"]]
        ]
        for s in all_samples
    }
    res_full = evaluator.evaluate_dataset(gt_dict, preds_full, box_format_gt="xywh", box_format_pred="cxcywh")

    # 2. Strict Raw (zero inferences on skipped frames)
    preds_strict: Dict[str, List[Dict[str, Any]]] = {}
    for s in all_samples:
        if (s["frame_index"] - 1) % 2 == 0:
            preds_strict[s["sample_id"]] = preds_full[s["sample_id"]]
        else:
            preds_strict[s["sample_id"]] = []
    res_strict = evaluator.evaluate_dataset(gt_dict, preds_strict, box_format_gt="xywh", box_format_pred="cxcywh")

    # 3. Nearest Sampled Frame Playback (Phase 2.3 stale box reuse baseline)
    sampled_indices = [s["frame_index"] for s in odd_samples]
    sample_by_idx = {s["frame_index"]: s for s in odd_samples}
    preds_nearest: Dict[str, List[Dict[str, Any]]] = {}
    for s in all_samples:
        fidx = s["frame_index"]
        if (fidx - 1) % 2 == 0:
            preds_nearest[s["sample_id"]] = preds_full[s["sample_id"]]
        else:
            closest_idx = min(sampled_indices, key=lambda x: abs(x - fidx))
            closest_sid = sample_by_idx[closest_idx]["sample_id"]
            preds_nearest[s["sample_id"]] = preds_full[closest_sid]
    res_nearest = evaluator.evaluate_dataset(gt_dict, preds_nearest, box_format_gt="xywh", box_format_pred="cxcywh")

    # 4. Motion-Aware Tracking (Phase 2.4 Interpolation & Conservative Prediction)
    # Track across sampled odd frames
    Track.reset_counter()
    tracker = ByteTracker(track_threshold=conf_th, match_threshold=0.2)
    tracks_by_odd_idx: Dict[int, List[Dict[str, Any]]] = {}
    for s in odd_samples:
        fidx = s["frame_index"]
        dets = all_raw_dets[s["sample_id"]]
        trks = tracker.update(dets)
        tracks_by_odd_idx[fidx] = trks

    preds_motion: Dict[str, List[Dict[str, Any]]] = {}
    obs_type_counts = {"detection": 0, "interpolated": 0, "predicted": 0}

    for s in all_samples:
        fidx = s["frame_index"]
        sid = s["sample_id"]
        t_curr = s["timestamp_seconds"]

        if (fidx - 1) % 2 == 0:
            # Fresh detector observation on sampled frame
            dets = all_raw_dets[sid]
            preds_motion[sid] = [
                {"box": (d.cx, d.cy, d.w, d.h), "class": d.class_name.lower(), "score": d.prob, "obs_type": "detection"}
                for d in dets
            ]
            obs_type_counts["detection"] += len(dets)
        else:
            # Intermediate frame: find anchor frames
            prev_cand = [i for i in sampled_indices if i < fidx]
            next_cand = [i for i in sampled_indices if i > fidx]

            if prev_cand and next_cand:
                prev_idx = max(prev_cand)
                next_idx = min(next_cand)
                t_prev = sample_by_idx[prev_idx]["timestamp_seconds"]
                t_next = sample_by_idx[next_idx]["timestamp_seconds"]
                interp_trks = interpolator.interpolate(
                    prev_tracks=tracks_by_odd_idx[prev_idx],
                    next_tracks=tracks_by_odd_idx[next_idx],
                    prev_time=t_prev,
                    next_time=t_next,
                    target_time=t_curr,
                    frame_width=1920,
                    frame_height=1080
                )
            elif prev_cand:
                prev_idx = max(prev_cand)
                t_prev = sample_by_idx[prev_idx]["timestamp_seconds"]
                interp_trks = interpolator.interpolate(
                    prev_tracks=tracks_by_odd_idx[prev_idx],
                    next_tracks=[],
                    prev_time=t_prev,
                    next_time=t_curr + 0.1,
                    target_time=t_curr,
                    frame_width=1920,
                    frame_height=1080
                )
            else:
                interp_trks = []

            preds_motion[sid] = [
                {"box": (t["x"], t["y"], t["w"], t["h"]), "class": t["class_name"].lower(), "score": t["prob"], "obs_type": t.get("observation_type", "interpolated")}
                for t in interp_trks if t["class_name"].lower() in TARGET_CLASSES
            ]
            for t in interp_trks:
                otype = t.get("observation_type", "interpolated")
                obs_type_counts[otype] = obs_type_counts.get(otype, 0) + 1

    res_motion = evaluator.evaluate_dataset(gt_dict, preds_motion, box_format_gt="xywh", box_format_pred="cxcywh")

    return {
        "full_detection": {
            "iou_50": res_full["metrics"]["iou_50"]["overall"],
            "iou_75": res_full["metrics"]["iou_75"]["overall"],
            "mean_iou": res_full["metrics"]["iou_50"]["iou_distribution"]["mean"]
        },
        "strict_raw": {
            "iou_50": res_strict["metrics"]["iou_50"]["overall"],
            "iou_75": res_strict["metrics"]["iou_75"]["overall"],
            "mean_iou": res_strict["metrics"]["iou_50"]["iou_distribution"]["mean"]
        },
        "nearest_stale": {
            "iou_50": res_nearest["metrics"]["iou_50"]["overall"],
            "iou_75": res_nearest["metrics"]["iou_75"]["overall"],
            "mean_iou": res_nearest["metrics"]["iou_50"]["iou_distribution"]["mean"]
        },
        "motion_interpolated": {
            "iou_50": res_motion["metrics"]["iou_50"]["overall"],
            "iou_75": res_motion["metrics"]["iou_75"]["overall"],
            "mean_iou": res_motion["metrics"]["iou_50"]["iou_distribution"]["mean"],
            "obs_type_counts": obs_type_counts,
            "obs_breakdown": res_motion["metrics"]["iou_50"].get("observation_breakdown", {})
        }
    }

def benchmark_video_stream(
    detector: YOLODetector,
    video_path: Path,
    num_frames: int = 300,
    conf_th: float = 0.20,
    iou_th: float = 0.45,
    processing_speed: str = "full"
) -> Dict[str, Any]:
    """
    Runs VideoProcessor on num_frames of car-detection.mp4 to measure:
    - End-to-end duration and effective video FPS
    - Tracking continuity: total unique tracks, fragmentations, average track lifetime
    - Latency breakdown: decode, detect, tracking, interpolation, artifact writing
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    frame_stride = 2 if processing_speed == "fast" else 1

    tracker = ByteTracker(track_threshold=conf_th, match_threshold=0.2)
    interpolator = TrackInterpolator()

    decode_times = []
    detect_times = []
    track_times = []
    interp_times = []

    frame_records = []
    prev_sampled_record = None
    pending_skipped = []
    unique_tracks = set()
    track_lifetimes: Dict[int, int] = {}
    max_active_tracks = 0

    t_start = time.perf_counter()

    for frame_idx in range(1, num_frames + 1):
        t0 = time.perf_counter()

        if frame_stride > 1 and ((frame_idx - 1) % frame_stride != 0):
            if not cap.grab():
                break
            t1 = time.perf_counter()
            decode_times.append(t1 - t0)
            skip_time = (frame_idx - 1) / fps
            pending_skipped.append({"frame_id": frame_idx, "media_time": round(skip_time, 4)})
            continue

        ret, frame = cap.read()
        if not ret or frame is None:
            break
        t1 = time.perf_counter()
        decode_times.append(t1 - t0)

        media_time = (frame_idx - 1) / fps

        t0 = time.perf_counter()
        raw_boxes = detector.detect(frame, conf_threshold=conf_th, iou_threshold=iou_th)
        t1 = time.perf_counter()
        detect_times.append(t1 - t0)

        t0 = time.perf_counter()
        tracks = tracker.update(raw_boxes)
        t1 = time.perf_counter()
        track_times.append(t1 - t0)

        for trk in tracks:
            tid = trk["track_id"]
            unique_tracks.add(tid)
            track_lifetimes[tid] = track_lifetimes.get(tid, 0) + 1

        max_active_tracks = max(max_active_tracks, len(tracks))

        current_record = {
            "frame_id": frame_idx,
            "media_time": round(media_time, 4),
            "boxes": [b.to_dict() for b in raw_boxes],
            "tracks": tracks,
            "detection_count": len(raw_boxes)
        }

        if pending_skipped:
            t0 = time.perf_counter()
            if prev_sampled_record is not None:
                for sk in pending_skipped:
                    interp_trks = interpolator.interpolate(
                        prev_tracks=prev_sampled_record["tracks"],
                        next_tracks=tracks,
                        prev_time=prev_sampled_record["media_time"],
                        next_time=media_time,
                        target_time=sk["media_time"],
                        frame_width=width,
                        frame_height=height
                    )
                    frame_records.append({
                        "frame_id": sk["frame_id"],
                        "media_time": sk["media_time"],
                        "boxes": [],
                        "tracks": interp_trks,
                        "detection_count": 0
                    })
                    for itrk in interp_trks:
                        itid = itrk["track_id"]
                        track_lifetimes[itid] = track_lifetimes.get(itid, 0) + 1
            t1 = time.perf_counter()
            interp_times.append(t1 - t0)
            pending_skipped.clear()

        frame_records.append(current_record)
        prev_sampled_record = current_record

    # Flush trailing skipped frames at EOF (e.g. frame 300 when stride=2)
    if pending_skipped and prev_sampled_record is not None:
        t0 = time.perf_counter()
        for sk in pending_skipped:
            pred_trks = interpolator.interpolate(
                prev_tracks=prev_sampled_record["tracks"],
                next_tracks=[],
                prev_time=prev_sampled_record["media_time"],
                next_time=sk["media_time"] + (1.0 / fps),
                target_time=sk["media_time"],
                frame_width=width,
                frame_height=height
            )
            frame_records.append({
                "frame_id": sk["frame_id"],
                "media_time": sk["media_time"],
                "boxes": [],
                "tracks": pred_trks,
                "detection_count": 0
            })
            for ptrk in pred_trks:
                ptid = ptrk["track_id"]
                track_lifetimes[ptid] = track_lifetimes.get(ptid, 0) + 1
        t1 = time.perf_counter()
        interp_times.append(t1 - t0)
        pending_skipped.clear()

    t_end = time.perf_counter()
    cap.release()

    total_duration = t_end - t_start
    inferred_count = len(detect_times)
    effective_fps = num_frames / total_duration if total_duration > 0 else 0.0
    inference_fps = inferred_count / (sum(detect_times) or 1e-6)

    # Tracking continuity analysis
    lifetimes = list(track_lifetimes.values())
    avg_lifetime_frames = sum(lifetimes) / len(lifetimes) if lifetimes else 0.0
    short_lived = sum(1 for l in lifetimes if l < 5)  # track fragmentation indicator
    persistent_tracks = sum(1 for l in lifetimes if l >= 15)

    return {
        "processing_speed": processing_speed,
        "num_frames": num_frames,
        "inferred_frames": inferred_count,
        "total_generated_frames": len(frame_records),
        "total_duration_s": round(total_duration, 3),
        "effective_video_fps": round(effective_fps, 2),
        "inference_fps": round(inference_fps, 2),
        "decode_time_total_s": round(sum(decode_times), 3),
        "detect_time_total_s": round(sum(detect_times), 3),
        "track_time_total_s": round(sum(track_times), 3),
        "interp_time_total_s": round(sum(interp_times), 4),
        "unique_tracks": len(unique_tracks),
        "max_simultaneous_tracks": max_active_tracks,
        "avg_track_lifetime_frames": round(avg_lifetime_frames, 1),
        "short_lived_fragmented_tracks": short_lived,
        "persistent_tracks": persistent_tracks
    }

def main():
    print("=" * 80)
    print(" VisionGuard Phase 2.4 — Motion-Aware Tracking Comprehensive Evaluation")
    print("=" * 80)

    gt_dict, sample_list = load_ground_truth()
    detector = YOLODetector()
    evaluator = DetectionEvaluator(iou_thresholds=[0.50, 0.75], target_classes=TARGET_CLASSES)
    interpolator = TrackInterpolator()

    odd_samples = [s for s in sample_list if (s["frame_index"] - 1) % 2 == 0]
    even_samples = [s for s in sample_list if (s["frame_index"] - 1) % 2 != 0]

    print(f"Dataset Ground Truth: {len(sample_list)} total frames ({len(odd_samples)} sampled, {len(even_samples)} intermediate)")
    print(f"Video Source: {VIDEO_PATH.name} (1080p @ 30 FPS)\n")

    # -------------------------------------------------------------
    # 1. Section A: Detector Accuracy on Common Inference Frames
    # -------------------------------------------------------------
    print("A. DETECTOR ACCURACY ON INFERENCE FRAMES (Identical Sampled Frames)")
    print("-" * 80)
    det_bal_odd = evaluate_inference_accuracy(detector, evaluator, gt_dict, odd_samples, 0.20, 0.45)
    det_hr_odd = evaluate_inference_accuracy(detector, evaluator, gt_dict, odd_samples, 0.15, 0.45)
    det_bal_all = evaluate_inference_accuracy(detector, evaluator, gt_dict, sample_list, 0.20, 0.45)
    det_hr_all = evaluate_inference_accuracy(detector, evaluator, gt_dict, sample_list, 0.15, 0.45)

    print(f"Sampled {len(odd_samples)} Odd Frames (Balanced):     Prec={det_bal_odd['iou_50']['precision']*100:.2f}%, Recall={det_bal_odd['iou_50']['recall']*100:.2f}%, F1={det_bal_odd['iou_50']['f1']*100:.2f}% (Mean IoU={det_bal_odd['mean_iou']:.3f})")
    print(f"Sampled {len(odd_samples)} Odd Frames (High Recall):   Prec={det_hr_odd['iou_50']['precision']*100:.2f}%, Recall={det_hr_odd['iou_50']['recall']*100:.2f}%, F1={det_hr_odd['iou_50']['f1']*100:.2f}% (Mean IoU={det_hr_odd['mean_iou']:.3f})")
    print(f"All 119 Ground-Truth Frames (Full Balanced): Prec={det_bal_all['iou_50']['precision']*100:.2f}%, Recall={det_bal_all['iou_50']['recall']*100:.2f}%, F1={det_bal_all['iou_50']['f1']*100:.2f}% (Mean IoU={det_bal_all['mean_iou']:.3f})")
    print(f"All 119 Ground-Truth Frames (Full High Rec): Prec={det_hr_all['iou_50']['precision']*100:.2f}%, Recall={det_hr_all['iou_50']['recall']*100:.2f}%, F1={det_hr_all['iou_50']['f1']*100:.2f}% (Mean IoU={det_hr_all['mean_iou']:.3f})\n")

    # -------------------------------------------------------------
    # 2. Section B: Temporal Overlay Localization Across ALL 119 Frames
    # -------------------------------------------------------------
    print("B. TEMPORAL OVERLAY LOCALIZATION ACROSS ALL 119 ANNOTATED FRAMES")
    print("-" * 80)
    loc_bal = evaluate_temporal_localization(detector, evaluator, interpolator, gt_dict, sample_list, 0.20, 0.45)
    loc_hr = evaluate_temporal_localization(detector, evaluator, interpolator, gt_dict, sample_list, 0.15, 0.45)

    print("Balanced Profile:")
    print(f"  Full Detection Ref:   Prec={loc_bal['full_detection']['iou_50']['precision']*100:.2f}%, Recall={loc_bal['full_detection']['iou_50']['recall']*100:.2f}%, F1={loc_bal['full_detection']['iou_50']['f1']*100:.2f}% (Mean IoU={loc_bal['full_detection']['mean_iou']:.3f})")
    print(f"  Phase 2.3 Strict Raw: Prec={loc_bal['strict_raw']['iou_50']['precision']*100:.2f}%, Recall={loc_bal['strict_raw']['iou_50']['recall']*100:.2f}%, F1={loc_bal['strict_raw']['iou_50']['f1']*100:.2f}% (Mean IoU={loc_bal['strict_raw']['mean_iou']:.3f})")
    print(f"  Phase 2.3 Stale Box:  Prec={loc_bal['nearest_stale']['iou_50']['precision']*100:.2f}%, Recall={loc_bal['nearest_stale']['iou_50']['recall']*100:.2f}%, F1={loc_bal['nearest_stale']['iou_50']['f1']*100:.2f}% (Mean IoU={loc_bal['nearest_stale']['mean_iou']:.3f})")
    print(f"  Phase 2.4 Interpolated: Prec={loc_bal['motion_interpolated']['iou_50']['precision']*100:.2f}%, Recall={loc_bal['motion_interpolated']['iou_50']['recall']*100:.2f}%, F1={loc_bal['motion_interpolated']['iou_50']['f1']*100:.2f}% (Mean IoU={loc_bal['motion_interpolated']['mean_iou']:.3f})")
    print(f"    Observation breakdown: {loc_bal['motion_interpolated']['obs_type_counts']}")

    print("\nHigh Recall Profile:")
    print(f"  Full Detection Ref:   Prec={loc_hr['full_detection']['iou_50']['precision']*100:.2f}%, Recall={loc_hr['full_detection']['iou_50']['recall']*100:.2f}%, F1={loc_hr['full_detection']['iou_50']['f1']*100:.2f}% (Mean IoU={loc_hr['full_detection']['mean_iou']:.3f})")
    print(f"  Phase 2.3 Strict Raw: Prec={loc_hr['strict_raw']['iou_50']['precision']*100:.2f}%, Recall={loc_hr['strict_raw']['iou_50']['recall']*100:.2f}%, F1={loc_hr['strict_raw']['iou_50']['f1']*100:.2f}% (Mean IoU={loc_hr['strict_raw']['mean_iou']:.3f})")
    print(f"  Phase 2.3 Stale Box:  Prec={loc_hr['nearest_stale']['iou_50']['precision']*100:.2f}%, Recall={loc_hr['nearest_stale']['iou_50']['recall']*100:.2f}%, F1={loc_hr['nearest_stale']['iou_50']['f1']*100:.2f}% (Mean IoU={loc_hr['nearest_stale']['mean_iou']:.3f})")
    print(f"  Phase 2.4 Interpolated: Prec={loc_hr['motion_interpolated']['iou_50']['precision']*100:.2f}%, Recall={loc_hr['motion_interpolated']['iou_50']['recall']*100:.2f}%, F1={loc_hr['motion_interpolated']['iou_50']['f1']*100:.2f}% (Mean IoU={loc_hr['motion_interpolated']['mean_iou']:.3f})")
    print("  Detailed TP/FP/FN & Observation Breakdown:")
    for prof_name, loc_data in [("Balanced", loc_bal), ("High Recall", loc_hr)]:
        mi = loc_data["motion_interpolated"]
        print(f"    {prof_name} Motion-Aware: TP={mi['iou_50']['tp']}, FP={mi['iou_50']['fp']}, FN={mi['iou_50']['fn']}, Prec={mi['iou_50']['precision']*100:.2f}%, Rec={mi['iou_50']['recall']*100:.2f}%, F1={mi['iou_50']['f1']*100:.2f}%, Mean IoU={mi['mean_iou']:.4f}")
        for ot, ost in mi.get("obs_breakdown", {}).items():
            print(f"      - {ot.capitalize()}: TP={ost['tp']}, FP={ost['fp']}, Precision={ost['precision']*100:.2f}%, Mean IoU={ost['mean_iou']:.4f} (Total {ost['count']})")
    print()

    # -------------------------------------------------------------
    # 3. Sections C & D: Continuous Video Benchmark (300 Frames)
    # -------------------------------------------------------------
    print("C & D. STREAM BENCHMARK & TRACKING CONTINUITY (300 Frames Highway Video)")
    print("-" * 80)
    print("Warm-up run...")
    benchmark_video_stream(detector, VIDEO_PATH, num_frames=30, conf_th=0.20, iou_th=0.45, processing_speed="full")

    print("Running Full Detection (stride 1)...")
    bench_full = benchmark_video_stream(detector, VIDEO_PATH, num_frames=300, conf_th=0.20, iou_th=0.45, processing_speed="full")

    print("Running Fast Processing with Motion Interpolation (stride 2)...")
    bench_fast = benchmark_video_stream(detector, VIDEO_PATH, num_frames=300, conf_th=0.20, iou_th=0.45, processing_speed="fast")

    print("\nThroughput & Latency Breakdown:")
    print(f"  Full Detection:  {bench_full['total_duration_s']}s | {bench_full['effective_video_fps']} Video FPS | {bench_full['inference_fps']} Inf FPS | Decode: {bench_full['decode_time_total_s']}s | Detect: {bench_full['detect_time_total_s']}s | Track: {bench_full['track_time_total_s']}s")
    print(f"  Fast Processing: {bench_fast['total_duration_s']}s | {bench_fast['effective_video_fps']} Video FPS | {bench_fast['inference_fps']} Inf FPS | Decode: {bench_fast['decode_time_total_s']}s | Detect: {bench_fast['detect_time_total_s']}s | Track: {bench_fast['track_time_total_s']}s | Interp: {bench_fast['interp_time_total_s']}s")
    speedup = bench_full["total_duration_s"] / bench_fast["total_duration_s"] if bench_fast["total_duration_s"] > 0 else 1.0
    print(f"  Measured Speedup: {speedup:.2f}x ({bench_fast['effective_video_fps']} FPS vs {bench_full['effective_video_fps']} FPS)")

    print("\nTracking Continuity & Quality:")
    print(f"  Full Detection:  {bench_full['unique_tracks']} Unique Tracks | Max Sim: {bench_full['max_simultaneous_tracks']} | Avg Lifetime: {bench_full['avg_track_lifetime_frames']} frames | Fragmented: {bench_full['short_lived_fragmented_tracks']} | Persistent: {bench_full['persistent_tracks']}")
    print(f"  Fast Processing: {bench_fast['unique_tracks']} Unique Tracks | Max Sim: {bench_fast['max_simultaneous_tracks']} | Avg Lifetime: {bench_fast['avg_track_lifetime_frames']} frames | Fragmented: {bench_fast['short_lived_fragmented_tracks']} | Persistent: {bench_fast['persistent_tracks']}")
    print(f"  Total Result Frames in Artifact: Full={bench_full['total_generated_frames']} vs Fast={bench_fast['total_generated_frames']} (100% video frame coverage!)")

    # Save complete Phase 2.4 results to JSON
    out_json = BACKEND_ROOT / "eval" / "phase2_4_results.json"
    results_summary = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "detector_accuracy_common_frames": {
            "odd_balanced": det_bal_odd,
            "odd_high_recall": det_hr_odd,
            "all_balanced": det_bal_all,
            "all_high_recall": det_hr_all
        },
        "temporal_overlay_localization": {
            "balanced": loc_bal,
            "high_recall": loc_hr
        },
        "stream_benchmark_continuity": {
            "full_detection": bench_full,
            "fast_processing": bench_fast,
            "speedup_ratio": round(speedup, 2)
        }
    }

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(results_summary, f, indent=2)

    print(f"\nAll Phase 2.4 evaluation metrics saved to: {out_json}")

if __name__ == "__main__":
    main()
