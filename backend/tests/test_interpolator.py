import pytest
from app.pipeline.interpolator import TrackInterpolator
from app.models.schemas import TrackedObject

def test_bilateral_interpolation_exact_midpoint():
    interpolator = TrackInterpolator()
    prev_tracks = [{
        "track_id": 42,
        "x": 100.0,
        "y": 200.0,
        "w": 50.0,
        "h": 40.0,
        "dx": 10.0,
        "dy": 5.0,
        "prob": 0.85,
        "class_id": 2,
        "class_name": "car",
        "speed": 60.0,
        "velocity": 58.0,
        "is_overspeed": False,
        "state": "Confirmed",
        "observation_type": "detection",
        "time_since_update": 0
    }]
    next_tracks = [{
        "track_id": 42,
        "x": 120.0,
        "y": 210.0,
        "w": 52.0,
        "h": 42.0,
        "dx": 10.0,
        "dy": 5.0,
        "prob": 0.90,
        "class_id": 2,
        "class_name": "car",
        "speed": 62.0,
        "velocity": 60.0,
        "is_overspeed": False,
        "state": "Confirmed",
        "observation_type": "detection",
        "time_since_update": 0
    }]

    # Interpolate at midpoint (t = 0.5s between 0.0s and 1.0s)
    interp = interpolator.interpolate(
        prev_tracks=prev_tracks,
        next_tracks=next_tracks,
        prev_time=0.0,
        next_time=1.0,
        target_time=0.5
    )

    assert len(interp) == 1
    t = interp[0]
    assert t["track_id"] == 42
    assert t["x"] == 110.0
    assert t["y"] == 205.0
    assert t["w"] == 51.0
    assert t["h"] == 41.0
    assert t["speed"] == 61.0
    assert t["velocity"] == 59.0
    assert t["prob"] == 0.85  # Preserved original detector observation confidence
    assert t["observation_type"] == "interpolated"
    assert t["prediction_confidence"] == 0.90  # 1.0 - 0.2 * abs(0.5 - 0.5) = 1.0 - 0.1? wait, 1.0 - 0.2 * 0 = 1.0 or 0.9? Wait, abs(alpha - 0.5) is 0, so 1.0 - 0 = 1.0

def test_track_id_mismatch_no_cross_interpolation():
    interpolator = TrackInterpolator(enable_unilateral_prediction=False)
    prev_tracks = [{
        "track_id": 1,
        "x": 100.0,
        "y": 100.0,
        "w": 50.0,
        "h": 50.0,
        "prob": 0.8,
        "class_id": 2,
        "class_name": "car",
        "state": "Confirmed",
        "time_since_update": 0
    }]
    next_tracks = [{
        "track_id": 2,
        "x": 110.0,
        "y": 110.0,
        "w": 50.0,
        "h": 50.0,
        "prob": 0.8,
        "class_id": 2,
        "class_name": "car",
        "state": "Confirmed",
        "time_since_update": 0
    }]

    interp = interpolator.interpolate(
        prev_tracks=prev_tracks,
        next_tracks=next_tracks,
        prev_time=0.0,
        next_time=1.0,
        target_time=0.5
    )

    # Must NOT interpolate across distinct track IDs
    assert len(interp) == 0

def test_motion_continuity_guard_large_jump():
    interpolator = TrackInterpolator(max_displacement_px=100.0)
    prev_tracks = [{
        "track_id": 1,
        "x": 100.0,
        "y": 100.0,
        "w": 50.0,
        "h": 50.0,
        "prob": 0.8,
        "class_id": 2,
        "class_name": "car",
        "state": "Confirmed",
        "time_since_update": 0
    }]
    # Displacement = sqrt(150^2 + 150^2) = 212.1px > 100px
    next_tracks = [{
        "track_id": 1,
        "x": 250.0,
        "y": 250.0,
        "w": 50.0,
        "h": 50.0,
        "prob": 0.8,
        "class_id": 2,
        "class_name": "car",
        "state": "Confirmed",
        "time_since_update": 0
    }]

    interp = interpolator.interpolate(
        prev_tracks=prev_tracks,
        next_tracks=next_tracks,
        prev_time=0.0,
        next_time=1.0,
        target_time=0.5
    )

    # Discontinuous jump rejected to maintain tracking integrity
    assert len(interp) == 0

def test_class_mismatch_rejected():
    interpolator = TrackInterpolator()
    prev_tracks = [{
        "track_id": 1,
        "x": 100.0,
        "y": 100.0,
        "w": 50.0,
        "h": 50.0,
        "prob": 0.8,
        "class_id": 2,
        "class_name": "car",
        "state": "Confirmed",
        "time_since_update": 0
    }]
    next_tracks = [{
        "track_id": 1,
        "x": 105.0,
        "y": 105.0,
        "w": 50.0,
        "h": 50.0,
        "prob": 0.8,
        "class_id": 7,
        "class_name": "truck",
        "state": "Confirmed",
        "time_since_update": 0
    }]

    interp = interpolator.interpolate(
        prev_tracks=prev_tracks,
        next_tracks=next_tracks,
        prev_time=0.0,
        next_time=1.0,
        target_time=0.5
    )

    assert len(interp) == 0

def test_unilateral_motion_prediction_and_expiry():
    interpolator = TrackInterpolator(enable_unilateral_prediction=True)
    prev_tracks = [{
        "track_id": 10,
        "x": 500.0,
        "y": 300.0,
        "w": 60.0,
        "h": 40.0,
        "dx": 20.0,
        "dy": -10.0,
        "prob": 0.75,
        "class_id": 2,
        "class_name": "car",
        "state": "Confirmed",
        "time_since_update": 0
    }]
    next_tracks = []  # Vehicle vanished from next frame

    interp = interpolator.interpolate(
        prev_tracks=prev_tracks,
        next_tracks=next_tracks,
        prev_time=0.0,
        next_time=0.06,
        target_time=0.03,
        frame_width=1920,
        frame_height=1080
    )

    assert len(interp) == 1
    pred = interp[0]
    assert pred["track_id"] == 10
    assert pred["observation_type"] == "predicted"
    assert pred["prediction_confidence"] == 0.50
    assert pred["time_since_update"] == 1
    # Check linear projection with alpha = 0.5
    assert pred["x"] == 510.0  # 500 + 20 * 0.5
    assert pred["y"] == 295.0  # 300 - 10 * 0.5

def test_tracked_object_schema_validation():
    obj_det = TrackedObject(
        track_id=1,
        x=100.0,
        y=100.0,
        w=50.0,
        h=50.0,
        prob=0.88,
        class_id=2,
        class_name="car",
        observation_type="detection",
        prediction_confidence=1.0
    )
    assert obj_det.observation_type == "detection"
    assert obj_det.prediction_confidence == 1.0

    obj_interp = TrackedObject(
        track_id=1,
        x=105.0,
        y=105.0,
        w=50.0,
        h=50.0,
        prob=0.85,
        class_id=2,
        class_name="car",
        observation_type="interpolated",
        prediction_confidence=0.95
    )
    assert obj_interp.observation_type == "interpolated"
    assert obj_interp.prediction_confidence == 0.95
