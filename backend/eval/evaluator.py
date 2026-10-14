"""
VisionGuard Evaluation Engine
Implements standard object detection evaluation:
- Greedy IoU matching at configurable thresholds (default 0.50 and 0.75)
- Overall and per-class Precision, Recall, and F1
- Size-based metrics (Small: area < 32^2, Medium: 32^2 <= area <= 96^2, Large: area > 96^2)
- Duplicate detection tracking (phantom duplicate boxes matching already-claimed ground truth)
- Bounding-box IoU distribution (mean, median, min, max, std)
- Class confusion matrix
"""

from typing import List, Dict, Any, Tuple, Optional
import numpy as np

def compute_iou(box1: Tuple[float, float, float, float], box2: Tuple[float, float, float, float], box_format: str = "xywh") -> float:
    """
    Compute Intersection over Union between two boxes.
    Format 'xywh': (top-left x, top-left y, width, height)
    Format 'cxcywh': (center x, center y, width, height)
    """
    if box_format == "cxcywh":
        x1_a = box1[0] - box1[2] * 0.5
        y1_a = box1[1] - box1[3] * 0.5
        x2_a = x1_a + box1[2]
        y2_a = y1_a + box1[3]

        x1_b = box2[0] - box2[2] * 0.5
        y1_b = box2[1] - box2[3] * 0.5
        x2_b = x1_b + box2[2]
        y2_b = y1_b + box2[3]
    else:  # xywh
        x1_a, y1_a = box1[0], box1[1]
        x2_a, y2_a = box1[0] + box1[2], box1[1] + box1[3]

        x1_b, y1_b = box2[0], box2[1]
        x2_b, y2_b = box2[0] + box2[2], box2[1] + box2[3]

    inter_x1 = max(x1_a, x1_b)
    inter_y1 = max(y1_a, y1_b)
    inter_x2 = min(x2_a, x2_b)
    inter_y2 = min(y2_a, y2_b)

    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    area_a = max(0.0, box1[2] * box1[3])
    area_b = max(0.0, box2[2] * box2[3])
    union_area = area_a + area_b - inter_area

    if union_area <= 0.0:
        return 0.0
    return inter_area / union_area

def get_area_category(w: float, h: float) -> str:
    """
    COCO standard area categories:
    small: area < 32^2 (1024)
    medium: 32^2 <= area <= 96^2 (9216)
    large: area > 96^2
    """
    area = w * h
    if area < 32.0 * 32.0:
        return "small"
    elif area <= 96.0 * 96.0:
        return "medium"
    else:
        return "large"

class DetectionEvaluator:
    def __init__(self, iou_thresholds: List[float] | None = None, target_classes: List[str] | None = None):
        self.iou_thresholds = iou_thresholds or [0.50, 0.75]
        self.target_classes = target_classes or ["car", "truck", "bus", "motorcycle"]

    def evaluate_dataset(
        self,
        ground_truth: Dict[str, List[Dict[str, Any]]],
        predictions: Dict[str, List[Dict[str, Any]]],
        box_format_gt: str = "xywh",
        box_format_pred: str = "cxcywh"
    ) -> Dict[str, Any]:
        """
        Evaluate full dataset.
        ground_truth: {frame_id: [{'box': (x,y,w,h), 'class': str, 'id': optional}]}
        predictions: {frame_id: [{'box': (cx,cy,w,h), 'class': str, 'score': float}]}
        """
        all_frames = sorted(list(set(ground_truth.keys()).union(predictions.keys())))

        # Evaluate at primary thresholds
        results_at_thresh = {}
        for iou_th in self.iou_thresholds:
            results_at_thresh[f"iou_{int(iou_th * 100)}"] = self._evaluate_at_threshold(
                all_frames=all_frames,
                ground_truth=ground_truth,
                predictions=predictions,
                iou_threshold=iou_th,
                box_format_gt=box_format_gt,
                box_format_pred=box_format_pred
            )

        return {
            "total_frames": len(all_frames),
            "metrics": results_at_thresh
        }

    def _evaluate_at_threshold(
        self,
        all_frames: List[str],
        ground_truth: Dict[str, List[Dict[str, Any]]],
        predictions: Dict[str, List[Dict[str, Any]]],
        iou_threshold: float,
        box_format_gt: str,
        box_format_pred: str
    ) -> Dict[str, Any]:
        tp_total = 0
        fp_total = 0
        fn_total = 0
        duplicate_boxes_total = 0
        matched_ious: List[float] = []

        # Per-class counts: {class_name: {'tp': int, 'fp': int, 'fn': int, 'matched_ious': []}}
        class_stats = {c: {"tp": 0, "fp": 0, "fn": 0, "matched_ious": []} for c in self.target_classes}
        other_fp = 0

        # Size breakdown: small, medium, large
        size_stats = {
            "small": {"tp": 0, "fp": 0, "fn": 0},
            "medium": {"tp": 0, "fp": 0, "fn": 0},
            "large": {"tp": 0, "fp": 0, "fn": 0}
        }

        # Observation breakdown: {obs_type: {tp, fp, matched_ious}}
        obs_stats: Dict[str, Dict[str, Any]] = {
            "detection": {"tp": 0, "fp": 0, "matched_ious": []},
            "interpolated": {"tp": 0, "fp": 0, "matched_ious": []},
            "predicted": {"tp": 0, "fp": 0, "matched_ious": []}
        }

        # Confusion matrix: {gt_class: {pred_class: count}}
        confusion: Dict[str, Dict[str, int]] = {
            c: {p: 0 for p in self.target_classes} for c in self.target_classes
        }

        for frame_id in all_frames:
            gt_list = ground_truth.get(frame_id, [])
            pred_list = predictions.get(frame_id, [])

            # Filter ground truth to target classes
            gt_filtered = [
                g for g in gt_list if g["class"].lower() in self.target_classes
            ]
            # Filter predictions to target classes
            pred_filtered = [
                p for p in pred_list if p["class"].lower() in self.target_classes
            ]

            # Sort predictions by confidence score descending
            pred_sorted = sorted(pred_filtered, key=lambda x: x.get("score", 1.0), reverse=True)

            gt_matched = [False] * len(gt_filtered)
            gt_matched_pred_idx = [-1] * len(gt_filtered)

            for p_idx, pred in enumerate(pred_sorted):
                p_box = tuple(pred["box"])
                p_class = pred["class"].lower()
                pred_area_cat = get_area_category(p_box[2], p_box[3])

                best_iou = 0.0
                best_gt_idx = -1

                # Find best matching ground truth box (class-specific first, then check confusion)
                for g_idx, gt in enumerate(gt_filtered):
                    g_box = tuple(gt["box"])
                    iou_val = compute_iou(
                        g_box, p_box,
                        box_format="xywh" if box_format_gt == "xywh" else "cxcywh"
                    ) if box_format_gt == box_format_pred else self._compute_mixed_iou(g_box, p_box, box_format_gt, box_format_pred)

                    if iou_val > best_iou:
                        best_iou = iou_val
                        best_gt_idx = g_idx

                p_otype = pred.get("obs_type", "detection")
                if p_otype not in obs_stats:
                    obs_stats[p_otype] = {"tp": 0, "fp": 0, "matched_ious": []}

                if best_iou >= iou_threshold and best_gt_idx >= 0:
                    best_gt = gt_filtered[best_gt_idx]
                    gt_class = best_gt["class"].lower()

                    if not gt_matched[best_gt_idx]:
                        # First detection matching this GT box
                        if p_class == gt_class:
                            # Exact class match -> True Positive
                            tp_total += 1
                            obs_stats[p_otype]["tp"] += 1
                            obs_stats[p_otype]["matched_ious"].append(best_iou)
                            gt_matched[best_gt_idx] = True
                            gt_matched_pred_idx[best_gt_idx] = p_idx
                            matched_ious.append(best_iou)

                            if p_class in class_stats:
                                class_stats[p_class]["tp"] += 1
                                class_stats[p_class]["matched_ious"].append(best_iou)

                            gt_box = best_gt["box"]
                            gt_cat = get_area_category(gt_box[2], gt_box[3])
                            size_stats[gt_cat]["tp"] += 1
                        else:
                            # Spatial match but wrong class -> Class Confusion
                            # Counted as FP for predicted class, and recorded in confusion matrix
                            fp_total += 1
                            obs_stats[p_otype]["fp"] += 1
                            if p_class in class_stats:
                                class_stats[p_class]["fp"] += 1
                            size_stats[pred_area_cat]["fp"] += 1

                            if gt_class in confusion and p_class in confusion[gt_class]:
                                confusion[gt_class][p_class] += 1
                    else:
                        # Ground truth box was ALREADY matched by an earlier, higher-confidence detection!
                        # This is a Duplicate Detection False Positive
                        fp_total += 1
                        obs_stats[p_otype]["fp"] += 1
                        duplicate_boxes_total += 1
                        if p_class in class_stats:
                            class_stats[p_class]["fp"] += 1
                        size_stats[pred_area_cat]["fp"] += 1
                else:
                    # No ground truth box overlaps with IoU >= threshold -> False Positive
                    fp_total += 1
                    obs_stats[p_otype]["fp"] += 1
                    if p_class in class_stats:
                        class_stats[p_class]["fp"] += 1
                    else:
                        other_fp += 1
                    size_stats[pred_area_cat]["fp"] += 1

            # Any unmatched ground truth box is a False Negative
            for g_idx, matched in enumerate(gt_matched):
                if not matched:
                    fn_total += 1
                    gt = gt_filtered[g_idx]
                    gt_class = gt["class"].lower()
                    if gt_class in class_stats:
                        class_stats[gt_class]["fn"] += 1
                    gt_box = gt["box"]
                    gt_cat = get_area_category(gt_box[2], gt_box[3])
                    size_stats[gt_cat]["fn"] += 1

        precision = tp_total / (tp_total + fp_total) if (tp_total + fp_total) > 0 else 0.0
        recall = tp_total / (tp_total + fn_total) if (tp_total + fn_total) > 0 else 0.0
        f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

        # Format per-class results
        per_class_results = {}
        for c, st in class_stats.items():
            c_p = st["tp"] / (st["tp"] + st["fp"]) if (st["tp"] + st["fp"]) > 0 else 0.0
            c_r = st["tp"] / (st["tp"] + st["fn"]) if (st["tp"] + st["fn"]) > 0 else 0.0
            c_f1 = (2 * c_p * c_r) / (c_p + c_r) if (c_p + c_r) > 0 else 0.0
            per_class_results[c] = {
                "tp": st["tp"],
                "fp": st["fp"],
                "fn": st["fn"],
                "precision": round(c_p, 4),
                "recall": round(c_r, 4),
                "f1": round(c_f1, 4),
                "mean_iou": round(float(np.mean(st["matched_ious"])), 4) if st["matched_ious"] else 0.0
            }

        # Format size breakdown
        per_size_results = {}
        for s_cat, st in size_stats.items():
            s_p = st["tp"] / (st["tp"] + st["fp"]) if (st["tp"] + st["fp"]) > 0 else 0.0
            s_r = st["tp"] / (st["tp"] + st["fn"]) if (st["tp"] + st["fn"]) > 0 else 0.0
            s_f1 = (2 * s_p * s_r) / (s_p + s_r) if (s_p + s_r) > 0 else 0.0
            per_size_results[s_cat] = {
                "tp": st["tp"],
                "fp": st["fp"],
                "fn": st["fn"],
                "precision": round(s_p, 4),
                "recall": round(s_r, 4),
                "f1": round(s_f1, 4)
            }

        iou_distribution = {
            "count": len(matched_ious),
            "mean": round(float(np.mean(matched_ious)), 4) if matched_ious else 0.0,
            "median": round(float(np.median(matched_ious)), 4) if matched_ious else 0.0,
            "min": round(float(np.min(matched_ious)), 4) if matched_ious else 0.0,
            "max": round(float(np.max(matched_ious)), 4) if matched_ious else 0.0,
            "std": round(float(np.std(matched_ious)), 4) if matched_ious else 0.0,
        }

        obs_breakdown = {}
        for ot, ost in obs_stats.items():
            ot_p = ost["tp"] / (ost["tp"] + ost["fp"]) if (ost["tp"] + ost["fp"]) > 0 else 0.0
            obs_breakdown[ot] = {
                "tp": ost["tp"],
                "fp": ost["fp"],
                "precision": round(ot_p, 4),
                "mean_iou": round(float(np.mean(ost["matched_ious"])), 4) if ost["matched_ious"] else 0.0,
                "count": ost["tp"] + ost["fp"]
            }

        return {
            "iou_threshold": iou_threshold,
            "overall": {
                "tp": tp_total,
                "fp": fp_total,
                "fn": fn_total,
                "duplicate_detections": duplicate_boxes_total,
                "precision": round(precision, 4),
                "recall": round(recall, 4),
                "f1": round(f1, 4)
            },
            "per_class": per_class_results,
            "per_size": per_size_results,
            "iou_distribution": iou_distribution,
            "confusion_matrix": confusion,
            "observation_breakdown": obs_breakdown
        }

    def _compute_mixed_iou(self, box1: Tuple[float, float, float, float], box2: Tuple[float, float, float, float], fmt1: str, fmt2: str) -> float:
        # Convert box1 to xyxy
        if fmt1 == "cxcywh":
            x1_a = box1[0] - box1[2] * 0.5
            y1_a = box1[1] - box1[3] * 0.5
            x2_a = x1_a + box1[2]
            y2_a = y1_a + box1[3]
        else:
            x1_a = box1[0]
            y1_a = box1[1]
            x2_a = box1[0] + box1[2]
            y2_a = box1[1] + box1[3]

        # Convert box2 to xyxy
        if fmt2 == "cxcywh":
            x1_b = box2[0] - box2[2] * 0.5
            y1_b = box2[1] - box2[3] * 0.5
            x2_b = x1_b + box2[2]
            y2_b = y1_b + box2[3]
        else:
            x1_b = box2[0]
            y1_b = box2[1]
            x2_b = box2[0] + box2[2]
            y2_b = box2[1] + box2[3]

        inter_x1 = max(x1_a, x1_b)
        inter_y1 = max(y1_a, y1_b)
        inter_x2 = min(x2_a, x2_b)
        inter_y2 = min(y2_a, y2_b)

        inter_w = max(0.0, inter_x2 - inter_x1)
        inter_h = max(0.0, inter_y2 - inter_y1)
        inter_area = inter_w * inter_h

        area_a = max(0.0, box1[2] * box1[3])
        area_b = max(0.0, box2[2] * box2[3])
        union_area = area_a + area_b - inter_area

        if union_area <= 0.0:
            return 0.0
        return inter_area / union_area
