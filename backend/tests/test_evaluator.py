import pytest
from eval.evaluator import DetectionEvaluator, compute_iou, get_area_category

def test_compute_iou():
    # Identical boxes xywh
    b1 = (0.0, 0.0, 10.0, 10.0)
    b2 = (0.0, 0.0, 10.0, 10.0)
    assert compute_iou(b1, b2, "xywh") == 1.0

    # Non-overlapping
    b3 = (20.0, 20.0, 10.0, 10.0)
    assert compute_iou(b1, b3, "xywh") == 0.0

    # Half overlap
    b4 = (5.0, 0.0, 10.0, 10.0)
    # intersection: x in [5, 10] (w=5), y in [0, 10] (h=10) -> area = 50
    # union: 100 + 100 - 50 = 150 -> iou = 50/150 = 1/3
    assert abs(compute_iou(b1, b4, "xywh") - (1.0 / 3.0)) < 1e-4

def test_area_categories():
    assert get_area_category(20, 20) == "small"    # 400 < 1024
    assert get_area_category(50, 50) == "medium"   # 2500 in [1024, 9216]
    assert get_area_category(100, 100) == "large"  # 10000 > 9216

def test_evaluator_metrics():
    evaluator = DetectionEvaluator(iou_thresholds=[0.50])
    gt = {
        "frame_1": [
            {"box": (100.0, 100.0, 50.0, 50.0), "class": "car"},
            {"box": (300.0, 300.0, 80.0, 80.0), "class": "truck"}
        ]
    }
    preds = {
        "frame_1": [
            # True Positive Car (cxcywh: center 125, 125 -> top-left 100, 100)
            {"box": (125.0, 125.0, 50.0, 50.0), "class": "car", "score": 0.95},
            # Duplicate detection on same Car
            {"box": (126.0, 125.0, 50.0, 50.0), "class": "car", "score": 0.85},
            # False Positive on empty road
            {"box": (500.0, 500.0, 30.0, 30.0), "class": "car", "score": 0.60}
        ]
    }
    res = evaluator.evaluate_dataset(gt, preds, box_format_gt="xywh", box_format_pred="cxcywh")
    m50 = res["metrics"]["iou_50"]["overall"]

    assert m50["tp"] == 1
    assert m50["duplicate_detections"] == 1
    assert m50["fp"] == 2  # 1 duplicate + 1 false positive on empty road
    assert m50["fn"] == 1  # 1 missed truck
    assert m50["precision"] == round(1 / 3, 4)
    assert m50["recall"] == round(1 / 2, 4)
