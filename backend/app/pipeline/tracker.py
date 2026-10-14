from typing import List, Tuple, Dict, Any, Optional
import math
from app.pipeline.detector import RawDetection

class KalmanFilter1D:
    """
    4 independent 1D Kalman filters for (cx, cy, w, h).
    Direct port of the mathematically verified Kalman implementation in apps/web/src/pipeline/tracker/kalman.ts.
    """
    __slots__ = ("states", "covs")

    def __init__(self, cx: float, cy: float, w: float, h: float):
        # [position, velocity]
        self.states = [
            [float(cx), 0.0],
            [float(cy), 0.0],
            [float(w), 0.0],
            [float(h), 0.0]
        ]
        # [p11, p12, p22]
        self.covs = [
            [10.0, 0.0, 100.0],
            [10.0, 0.0, 100.0],
            [10.0, 0.0, 100.0],
            [10.0, 0.0, 100.0]
        ]

    def predict(self) -> None:
        q_p = 1.0
        q_v = 0.01

        for i in range(4):
            state = self.states[i]
            cov = self.covs[i]

            # Position updates with velocity only for center (i < 2).
            # Width and height keep v=0 to prevent runaway bounding boxes.
            if i < 2:
                state[0] += state[1]
                state[1] *= 0.65

            # Covariance prediction
            p11 = cov[0] + 2.0 * cov[1] + cov[2] + q_p
            p12 = cov[1] + cov[2]
            p22 = cov[2] + q_v

            cov[0] = p11
            cov[1] = p12
            cov[2] = p22

    def update(self, cx: float, cy: float, w: float, h: float) -> None:
        r = 0.1
        z = [float(cx), float(cy), float(w), float(h)]

        for i in range(4):
            state = self.states[i]
            cov = self.covs[i]

            y = z[i] - state[0]
            s = cov[0] + r
            k1 = cov[0] / s
            k2 = cov[1] / s

            state[0] += k1 * y
            if i < 2:
                state[1] += k2 * y
            else:
                state[1] = 0.0  # Force width/height velocity to zero

            cov[0] = (1.0 - k1) * cov[0]
            cov[1] = (1.0 - k1) * cov[1]
            cov[2] = cov[2] - k2 * cov[1]

    def get_state(self) -> Dict[str, float]:
        return {
            "cx": self.states[0][0],
            "cy": self.states[1][0],
            "w": max(0.0, self.states[2][0]),
            "h": max(0.0, self.states[3][0]),
            "dx": self.states[0][1],
            "dy": self.states[1][1],
            "dw": self.states[2][1],
            "dh": self.states[3][1],
        }

def calculate_iou(box1_cx: float, box1_cy: float, box1_w: float, box1_h: float,
                  box2_cx: float, box2_cy: float, box2_w: float, box2_h: float) -> float:
    x1 = max(box1_cx - box1_w / 2.0, box2_cx - box2_w / 2.0)
    y1 = max(box1_cy - box1_h / 2.0, box2_cy - box2_h / 2.0)
    x2 = min(box1_cx + box1_w / 2.0, box2_cx + box2_w / 2.0)
    y2 = min(box1_cy + box1_h / 2.0, box2_cy + box2_h / 2.0)

    w = max(0.0, x2 - x1)
    h = max(0.0, y2 - y1)
    intersection = w * h

    area1 = box1_w * box1_h
    area2 = box2_w * box2_h
    union = area1 + area2 - intersection

    return intersection / union if union > 0 else 0.0

class Track:
    _id_counter: int = 1

    @classmethod
    def reset_counter(cls) -> None:
        cls._id_counter = 1

    def __init__(self, detection: RawDetection):
        self.track_id: int = Track._id_counter
        Track._id_counter += 1

        self.kf = KalmanFilter1D(detection.cx, detection.cy, detection.w, detection.h)
        self.state: str = "Tentative"  # Tentative, Confirmed, Lost, Removed
        self.hit_count: int = 1
        self.frame_count: int = 1
        self.time_since_update: int = 0

        self.prob: float = detection.prob
        self.class_id: int = detection.class_id
        self.class_name: str = detection.class_name
        self.last_box: Optional[RawDetection] = detection

    def predict(self) -> None:
        self.kf.predict()
        self.frame_count += 1
        self.time_since_update += 1

    def update(self, detection: RawDetection) -> None:
        self.kf.update(detection.cx, detection.cy, detection.w, detection.h)
        self.hit_count += 1
        self.time_since_update = 0
        self.prob = detection.prob
        self.class_id = detection.class_id
        self.class_name = detection.class_name
        self.last_box = detection

        if self.state == "Tentative" and self.hit_count >= 2:
            self.state = "Confirmed"

    def reactivate(self, detection: RawDetection) -> None:
        self.kf.update(detection.cx, detection.cy, detection.w, detection.h)
        self.hit_count += 1
        self.time_since_update = 0
        self.state = "Confirmed"
        self.prob = detection.prob
        self.class_id = detection.class_id
        self.class_name = detection.class_name
        self.last_box = detection

    def mark_lost(self) -> None:
        self.state = "Lost"

    def mark_removed(self) -> None:
        self.state = "Removed"

def class_group(class_id: int) -> int:
    """
    Traffic association grouping:
    - 1, 3: bicycle, motorcycle (two-wheel vehicles)
    - 2, 5, 7: car, bus, truck (four-wheel road vehicles)
    - 0: person
    Tracks will never associate with detections of a different object kind.
    """
    if class_id in (1, 3):
        return 1
    if class_id in (2, 5, 7):
        return 2
    return class_id

class ByteTracker:
    def __init__(self, track_threshold: float = 0.5, match_threshold: float = 0.2, max_time_lost: int = 30):
        self.tracks: List[Track] = []
        self.track_threshold = track_threshold
        self.match_threshold = match_threshold
        self.max_time_lost = max_time_lost

    def reset(self) -> None:
        self.tracks.clear()
        Track.reset_counter()

    def _associate(self, detections: List[RawDetection], tracks: List[Track], threshold: float) -> Tuple[List[Tuple[int, int]], List[int], List[int]]:
        """
        Greedy bipartite matching sorted by highest IoU with class gating.
        Returns: (matches, unmatched_tracks, unmatched_detections)
        """
        if not tracks or not detections:
            return [], list(range(len(tracks))), list(range(len(detections)))

        pairs = []
        for t_idx, track in enumerate(tracks):
            state = track.kf.get_state()
            for d_idx, det in enumerate(detections):
                if class_group(track.class_id) != class_group(det.class_id):
                    continue
                iou = calculate_iou(state["cx"], state["cy"], state["w"], state["h"],
                                    det.cx, det.cy, det.w, det.h)
                if iou >= threshold:
                    pairs.append((iou, t_idx, d_idx))

        # Sort pairs by highest IoU descending
        pairs.sort(key=lambda x: x[0], reverse=True)

        matched_tracks = set()
        matched_dets = set()
        matches: List[Tuple[int, int]] = []

        for _, t_idx, d_idx in pairs:
            if t_idx not in matched_tracks and d_idx not in matched_dets:
                matched_tracks.add(t_idx)
                matched_dets.add(d_idx)
                matches.append((t_idx, d_idx))

        unmatched_tracks = [i for i in range(len(tracks)) if i not in matched_tracks]
        unmatched_dets = [i for i in range(len(detections)) if i not in matched_dets]

        return matches, unmatched_tracks, unmatched_dets

    def update(self, detections: List[RawDetection]) -> List[Dict[str, Any]]:
        # 1. Predict
        for t in self.tracks:
            t.predict()

        # 2. Split detections by confidence
        high_dets = [d for d in detections if d.prob >= self.track_threshold]
        low_dets = [d for d in detections if d.prob < self.track_threshold]

        # 3. Separate tracks
        active_tracks = [t for t in self.tracks if t.state in ("Confirmed", "Tentative")]
        lost_tracks = [t for t in self.tracks if t.state == "Lost"]

        # 4. First association: high detections with active tracks
        matches1, unmatched_tracks1_idx, unmatched_high1_idx = self._associate(high_dets, active_tracks, self.match_threshold)
        for t_idx, d_idx in matches1:
            active_tracks[t_idx].update(high_dets[d_idx])

        # 5. Second association: low detections with unmatched active tracks
        unmatched_active_tracks = [active_tracks[i] for i in unmatched_tracks1_idx]
        matches2, unmatched_tracks2_idx, _ = self._associate(low_dets, unmatched_active_tracks, 0.5)
        for t_idx, d_idx in matches2:
            unmatched_active_tracks[t_idx].update(low_dets[d_idx])

        # 6. Mark remaining unmatched active tracks as Lost
        still_unmatched_active = [unmatched_active_tracks[i] for i in unmatched_tracks2_idx]
        for t in still_unmatched_active:
            t.mark_lost()

        # 7. Third association: remaining high detections with lost tracks
        unmatched_high_dets = [high_dets[i] for i in unmatched_high1_idx]
        matches3, _, unmatched_high2_idx = self._associate(unmatched_high_dets, lost_tracks, 0.3)
        for t_idx, d_idx in matches3:
            lost_tracks[t_idx].reactivate(unmatched_high_dets[d_idx])

        # 8. Clean up lost tracks exceeding max_time_lost
        for t in lost_tracks:
            if t.state == "Lost" and t.time_since_update > self.max_time_lost:
                t.mark_removed()

        # 9. Create new tracks from remaining unmatched high detections
        for d_idx in unmatched_high2_idx:
            new_track = Track(unmatched_high_dets[d_idx])
            self.tracks.append(new_track)

        # 10. Filter out removed tracks
        self.tracks = [t for t in self.tracks if t.state != "Removed"]

        # 11. Format results: only return fresh tracks (time_since_update <= 1)
        results: List[Dict[str, Any]] = []
        for t in self.tracks:
            if (t.state == "Confirmed" and t.time_since_update <= 1) or (t.state == "Tentative" and t.time_since_update == 0):
                kf_state = t.kf.get_state()
                # For freshly detected frames, use exact detected box to prevent Kalman drift
                if t.time_since_update == 0 and t.last_box:
                    box_x = t.last_box.cx
                    box_y = t.last_box.cy
                    box_w = t.last_box.w
                    box_h = t.last_box.h
                else:
                    box_x = kf_state["cx"]
                    box_y = kf_state["cy"]
                    box_w = kf_state["w"]
                    box_h = kf_state["h"]

                # Strict geometry validation
                if not (math.isfinite(box_x) and math.isfinite(box_y) and math.isfinite(box_w) and math.isfinite(box_h)):
                    continue
                if box_w < 4.0 or box_h < 4.0:
                    continue

                results.append({
                    "track_id": t.track_id,
                    "x": round(box_x, 2),
                    "y": round(box_y, 2),
                    "w": round(box_w, 2),
                    "h": round(box_h, 2),
                    "dx": round(kf_state["dx"], 2),
                    "dy": round(kf_state["dy"], 2),
                    "prob": round(t.prob, 4),
                    "class_id": t.class_id,
                    "class_name": t.class_name,
                    "state": t.state,
                    "time_since_update": t.time_since_update,
                    "observation_type": "detection" if t.time_since_update == 0 else "predicted",
                    "prediction_confidence": 1.0 if t.time_since_update == 0 else round(max(0.0, 1.0 - 0.2 * t.time_since_update), 2)
                })

        return results
