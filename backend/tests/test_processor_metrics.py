"""Deterministic processor test: no model download or real video asset required."""
from pathlib import Path

import numpy as np

from app.pipeline import processor as processor_module


def test_video_summary_counts_detections_and_confirmed_speeding_episodes(tmp_path, monkeypatch):
    num_frames = 12
    flags = [True] * 4 + [False] * 3 + [True] * 3 + [False] * 2

    class FakeCapture:
        idx = 0

        def isOpened(self):
            return True

        def get(self, prop):
            cv2 = processor_module.cv2
            if prop == cv2.CAP_PROP_FRAME_WIDTH:
                return 640
            if prop == cv2.CAP_PROP_FRAME_HEIGHT:
                return 480
            if prop == cv2.CAP_PROP_FPS:
                return 30
            if prop == cv2.CAP_PROP_FRAME_COUNT:
                return num_frames
            if prop == cv2.CAP_PROP_POS_MSEC:
                return self.idx / 30 * 1000
            return 0

        def read(self):
            if self.idx >= num_frames:
                return False, None
            self.idx += 1
            return True, np.zeros((480, 640, 3), dtype=np.uint8)

        def grab(self):
            if self.idx >= num_frames:
                return False
            self.idx += 1
            return True

        def release(self):
            pass

    class FakeBox:
        def to_dict(self):
            return {"x": 100, "y": 200, "w": 60, "h": 45,
                    "prob": 0.9, "class_id": 2, "class_name": "car"}

    class FakeDetector:
        count = 0

        def detect(self, frame, **kwargs):
            self.count += 1
            return [FakeBox()] * (1 if self.count % 2 else 2)

    class FakeTracker:
        def __init__(self, **kwargs):
            pass

        def update(self, boxes):
            return [{"track_id": 11, "x": 100, "y": 200,
                     "w": 60, "h": 45, "class_name": "car",
                     "observation_type": "detection",
                     "prob": 0.9, "class_id": 2}]

    class FakeSpeedEstimator:
        idx = 0
        is_calibrated = True

        def __init__(self, **kwargs):
            pass

        def update(self, **kwargs):
            over = flags[self.idx]
            self.idx += 1
            return {"speed": 85.0 if over else 30.0,
                    "velocity": 0.0, "is_overspeed": over}

    monkeypatch.setattr(processor_module.cv2, "VideoCapture", lambda _: FakeCapture())
    monkeypatch.setattr(processor_module, "ByteTracker", FakeTracker)
    monkeypatch.setattr(processor_module, "SpeedEstimator", FakeSpeedEstimator)
    video_path = Path(tmp_path) / "synthetic.mp4"
    video_path.touch()
    result = processor_module.VideoProcessor(detector=FakeDetector()).process_video(
        video_path=video_path,
        job_id="unit-test",
        is_cancelled=lambda: False,
        progress_callback=lambda *_args: None,
        homography_matrix=[1.0] * 9,
    )
    summary = result["summary"]
    assert summary["processed_frames"] == 12
    assert summary["detections_generated"] == 18
    assert summary["speed_violations_count"] == 2
    assert summary["unique_vehicles"] == 1
    assert sum(f["detection_count"] for f in result["frames"]) == 18
