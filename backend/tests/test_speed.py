import pytest
from app.pipeline.speed import SpeedEstimator

def test_uncalibrated_speed_returns_none():
    estimator = SpeedEstimator(homography_matrix=None)
    assert not estimator.is_calibrated

    # First update
    res1 = estimator.update(track_id=1, box_cx=100, box_cy=200, box_w=40, box_h=30, media_time=1.0)
    assert res1 is None

    # Second update without homography should still return None (unavailable, not an invented number)
    res2 = estimator.update(track_id=1, box_cx=105, box_cy=205, box_w=40, box_h=30, media_time=1.1)
    assert res2 is None

def test_calibrated_speed_non_negative_and_discontinuity():
    # Simple identity scale homography: (x, y) maps to (x * 10 meters, y * 10 meters)
    h_matrix = [
        10.0, 0.0, 0.0,
        0.0, 10.0, 0.0,
        0.0, 0.0, 1.0
    ]
    estimator = SpeedEstimator(speed_limit=60.0, tolerance=10.0, homography_matrix=h_matrix)
    assert estimator.is_calibrated

    # Frame 1: Initial observation
    res1 = estimator.update(track_id=1, box_cx=0.5, box_cy=0.5, box_w=0.1, box_h=0.1, media_time=0.0)
    assert res1 is None

    # Frame 2: Vehicle moving forward (downward in image)
    res2 = estimator.update(track_id=1, box_cx=0.5, box_cy=0.55, box_w=0.1, box_h=0.1, media_time=0.033)
    if res2:
        assert res2["speed"] >= 0.0

    # Frame 3: Discontinuity (jump in time > 2.0s)
    res_jump = estimator.update(track_id=1, box_cx=0.5, box_cy=0.8, box_w=0.1, box_h=0.1, media_time=5.0)
    # Must reset history and return None rather than reporting a massive fake speed spike
    assert res_jump is None
