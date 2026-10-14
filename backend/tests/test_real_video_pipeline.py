import cv2
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.pipeline.detector import YOLODetector
from app.pipeline.tracker import ByteTracker

def test_real_video_tracking():
    video_path = Path(__file__).resolve().parent.parent.parent / "assets" / "car-detection.mp4"
    if not video_path.exists():
        print(f"Video not found at {video_path}")
        return

    model_path = Path(__file__).resolve().parent.parent.parent / "apps" / "web" / "public" / "models" / "yolo11n.onnx"
    detector = YOLODetector(model_path)
    assert detector.is_ready, "Detector session must be ready"

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS)

    tracker = ByteTracker(track_threshold=0.45, match_threshold=0.2, max_time_lost=30)
    tracker.reset()

    print("\n=== Running Consecutive Frame Tracking Test (Frames 0-90) ===")
    frame_track_history = {}
    for f_idx in range(90):
        ret, frame = cap.read()
        if not ret:
            break
        dets = detector.detect(frame, conf_threshold=0.25, iou_threshold=0.45)
        tracks = tracker.update(dets)
        confirmed = [t for t in tracks if t["state"] == "Confirmed"]
        track_ids = [t["track_id"] for t in confirmed]
        frame_track_history[f_idx] = track_ids

        # Ensure no manhole cover artifact (around x=884, y=760) is ever tracked as a vehicle
        for t in tracks:
            assert not (800 < t["x"] < 950 and 700 < t["y"] < 850), f"Manhole cover incorrectly tracked as vehicle at frame {f_idx}: {t}"

        if f_idx == 30:
            print("\n=== Detailed Tracks at Frame 30 ===")
            for t in tracks:
                print(f"Track #{t['track_id']} ({t['class_name']} {t['prob']:.2f}): [{t['x']}, {t['y']}, {t['w']}, {t['h']}] state={t['state']}")
            print("===================================\n")

    # Check stability of continuous tracks
    # Once a track appears in frame 15, does it stay alive through frame 45?
    tracks_at_15 = set(frame_track_history[15])
    tracks_at_30 = set(frame_track_history[30])
    common_tracks = tracks_at_15.intersection(tracks_at_30)
    print(f"Tracks at frame 15: {tracks_at_15}")
    print(f"Tracks at frame 30: {tracks_at_30}")
    print(f"Common tracks retained without ID churn: {common_tracks}")
    assert len(common_tracks) >= 6, f"Expected at least 6 stable persistent tracks, got {len(common_tracks)}"

    # Check later segment (Frames 1000-1090)
    print("\n=== Running Consecutive Frame Tracking Test (Frames 1000-1090) ===")
    cap.set(cv2.CAP_PROP_POS_FRAMES, 1000)
    tracker.reset()
    for f_idx in range(1000, 1085):
        ret, frame = cap.read()
        if not ret:
            break
        dets = detector.detect(frame, conf_threshold=0.25, iou_threshold=0.45)
        tracks = tracker.update(dets)
        if f_idx in (1005, 1040, 1080):
            confirmed = [t for t in tracks if t["state"] == "Confirmed"]
            print(f"Frame {f_idx}: {len(dets)} dets -> {len(confirmed)} confirmed tracks: {[t['track_id'] for t in confirmed]}")
            # Ensure no nested duplicate boxes exist among tracks
            for i, t1 in enumerate(confirmed):
                for j, t2 in enumerate(confirmed):
                    if i >= j: continue
                    x1 = max(t1['x'] - t1['w']/2, t2['x'] - t2['w']/2)
                    y1 = max(t1['y'] - t1['h']/2, t2['y'] - t2['h']/2)
                    x2 = min(t1['x'] + t1['w']/2, t2['x'] + t2['w']/2)
                    y2 = min(t1['y'] + t1['h']/2, t2['y'] + t2['h']/2)
                    inter = max(0, x2 - x1) * max(0, y2 - y1)
                    if inter > 0:
                        iom = inter / min(t1['w'] * t1['h'], t2['w'] * t2['h'])
                        assert iom < 0.65, f"Nested overlapping track detected! #{t1['track_id']} and #{t2['track_id']} have IoM {iom:.2f}"

    cap.release()

if __name__ == "__main__":
    test_real_video_tracking()
