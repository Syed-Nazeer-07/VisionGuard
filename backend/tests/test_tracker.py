import pytest
from app.pipeline.detector import RawDetection
from app.pipeline.tracker import KalmanFilter1D, ByteTracker, calculate_iou

def test_kalman_filter_dimensions_velocity():
    kf = KalmanFilter1D(cx=100.0, cy=200.0, w=50.0, h=40.0)
    kf.update(cx=105.0, cy=205.0, w=52.0, h=41.0)
    state = kf.get_state()

    # Center coordinates can acquire velocity
    assert state["cx"] > 100.0
    assert state["cy"] > 200.0
    # Width and height velocity forced to 0
    assert state["dw"] == 0.0
    assert state["dh"] == 0.0

def test_iou_calculation():
    # Identical boxes
    iou_same = calculate_iou(100, 100, 50, 50, 100, 100, 50, 50)
    assert abs(iou_same - 1.0) < 1e-4

    # Disjoint boxes
    iou_disjoint = calculate_iou(0, 0, 10, 10, 100, 100, 10, 10)
    assert iou_disjoint == 0.0

    # 50% overlap box
    iou_half = calculate_iou(50, 50, 100, 100, 100, 50, 100, 100)
    assert 0.0 < iou_half < 1.0

def test_tracker_id_stability():
    tracker = ByteTracker(track_threshold=0.5, match_threshold=0.2)
    tracker.reset()

    # Frame 1: Vehicle appears
    det1 = [RawDetection(cx=200.0, cy=300.0, w=80.0, h=60.0, prob=0.9, class_id=2, class_name="car")]
    tracks_f1 = tracker.update(det1)
    assert len(tracks_f1) == 1
    t1_id = tracks_f1[0]["track_id"]

    # Frame 2: Vehicle moved slightly
    det2 = [RawDetection(cx=205.0, cy=302.0, w=80.0, h=60.0, prob=0.92, class_id=2, class_name="car")]
    tracks_f2 = tracker.update(det2)
    assert len(tracks_f2) == 1
    assert tracks_f2[0]["track_id"] == t1_id
    assert tracks_f2[0]["state"] == "Confirmed"
    # Exact box preservation on detected frames
    assert tracks_f2[0]["x"] == 205.0
    assert tracks_f2[0]["y"] == 302.0

def test_duplicate_detection_does_not_fragment_tracks():
    tracker = ByteTracker(track_threshold=0.5, match_threshold=0.2)
    tracker.reset()

    # Frame 1: Vehicle detected with high confidence
    det1 = [RawDetection(cx=200.0, cy=300.0, w=80.0, h=60.0, prob=0.9, class_id=2, class_name="car")]
    tracks_f1 = tracker.update(det1)
    assert len(tracks_f1) == 1
    car_id = tracks_f1[0]["track_id"]

    # Frame 2: Vehicle moved, but single true detection present
    det2 = [RawDetection(cx=205.0, cy=302.0, w=80.0, h=60.0, prob=0.88, class_id=2, class_name="car")]
    tracks_f2 = tracker.update(det2)
    assert len(tracks_f2) == 1
    assert tracks_f2[0]["track_id"] == car_id

def test_class_grouping():
    from app.pipeline.tracker import class_group
    assert class_group(2) == 2  # car
    assert class_group(5) == 2  # bus
    assert class_group(7) == 2  # truck
    assert class_group(0) == 0  # person
    assert class_group(1) == 1  # bicycle
    assert class_group(3) == 3  # motorcycle

def test_tracker_class_voting_stability():
    tracker = ByteTracker(track_threshold=0.5, match_threshold=0.2)
    tracker.reset()

    # 3 confident car frames
    tracks1 = tracker.update([RawDetection(cx=200.0, cy=300.0, w=80.0, h=60.0, prob=0.95, class_id=2, class_name="car")])
    assert tracks1[0]["class_name"] == "car"
    track_id = tracks1[0]["track_id"]

    tracker.update([RawDetection(cx=202.0, cy=301.0, w=80.0, h=60.0, prob=0.95, class_id=2, class_name="car")])
    tracker.update([RawDetection(cx=204.0, cy=302.0, w=80.0, h=60.0, prob=0.95, class_id=2, class_name="car")])

    # 1 frame momentarily detected as truck
    tracks_noisy = tracker.update([RawDetection(cx=206.0, cy=303.0, w=80.0, h=60.0, prob=0.85, class_id=7, class_name="truck")])
    assert len(tracks_noisy) == 1
    assert tracks_noisy[0]["track_id"] == track_id
    # Decayed voting keeps stable class 'car'
    assert tracks_noisy[0]["class_name"] == "car"


