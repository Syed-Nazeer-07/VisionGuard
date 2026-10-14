from typing import Dict, List, Optional, Tuple, Any
import math

class SpeedEstimator:
    """
    Speed estimation via calibrated ground-plane homography.
    If homography calibration is not provided, physical speed is marked unavailable (None).
    Never reports negative speed or uncalibrated pixel-based guesses.
    """
    def __init__(self, speed_limit: float = 60.0, tolerance: float = 10.0, homography_matrix: Optional[List[float]] = None):
        self.speed_limit = speed_limit
        self.tolerance = tolerance
        self.h_matrix = homography_matrix  # 9-element list for 3x3 matrix
        self.history: Dict[int, Dict[str, Any]] = {}
        self.stationary_enter_threshold = 3.0  # km/h
        self.stationary_exit_threshold = 7.0   # km/h

    def set_homography(self, h_matrix: Optional[List[float]]) -> None:
        self.h_matrix = h_matrix
        self.history.clear()

    @property
    def is_calibrated(self) -> bool:
        return self.h_matrix is not None and len(self.h_matrix) == 9

    def project_point(self, x: float, y: float) -> Tuple[float, float]:
        if not self.h_matrix or len(self.h_matrix) != 9:
            raise ValueError("Invalid homography matrix")
        h = self.h_matrix
        w = h[6] * x + h[7] * y + h[8]
        if abs(w) < 1e-7:
            w = 1e-7
        px = (h[0] * x + h[1] * y + h[2]) / w
        py = (h[3] * x + h[4] * y + h[5]) / w
        return px, py

    def update(
        self,
        track_id: int,
        box_cx: float,
        box_cy: float,
        box_w: float,
        box_h: float,
        media_time: float,
        norm_width: float = 1.0,
        norm_height: float = 1.0
    ) -> Optional[Dict[str, Any]]:
        # If no homography calibration is available, speed is unavailable
        if not self.is_calibrated:
            return None

        # Bottom-center contact point in normalized [0, 1] coordinates
        norm_x = box_cx / norm_width
        norm_y = (box_cy + box_h / 2.0) / norm_height

        try:
            world_x, world_y = self.project_point(norm_x, norm_y)
        except Exception:
            return None

        state = self.history.get(track_id)
        if state is None:
            self.history[track_id] = {
                "last_world_x": world_x,
                "last_world_y": world_y,
                "last_time": media_time,
                "speeds": [],
                "is_stationary": True
            }
            return None

        dt = media_time - state["last_time"]

        # Discontinuity or backward seek: reset history for this vehicle
        if dt < 0 or dt > 2.0:
            state["last_world_x"] = world_x
            state["last_world_y"] = world_y
            state["last_time"] = media_time
            state["speeds"].clear()
            state["is_stationary"] = True
            return None

        # Redundant or negligible time step
        if dt <= 0.001:
            return None

        dx = world_x - state["last_world_x"]
        dy = world_y - state["last_world_y"]

        vx_mps = dx / dt
        vy_mps = dy / dt

        # Vector velocity magnitude in m/s
        speed_mps = math.hypot(vx_mps, vy_mps)

        # Reject impossible physical jumps (> 60 m/s = 216 km/h)
        if speed_mps > 60.0:
            state["last_world_x"] = world_x
            state["last_world_y"] = world_y
            state["last_time"] = media_time
            return None

        # Speed magnitude in km/h (strictly non-negative)
        raw_speed_kmh = speed_mps * 3.6
        vy_kmh = vy_mps * 3.6

        # Stationary hysteresis to prevent jitter at red lights / stops
        speeds = state["speeds"]
        speeds.append(raw_speed_kmh)
        if len(speeds) > 5:
            speeds.pop(0)

        # Minimum 2 speed samples (3 sightings) required before reporting valid speed
        if len(speeds) < 2:
            state["last_world_x"] = world_x
            state["last_world_y"] = world_y
            state["last_time"] = media_time
            return None

        avg_speed = sum(speeds) / len(speeds)

        if state["is_stationary"]:
            if avg_speed > self.stationary_exit_threshold:
                state["is_stationary"] = False
                final_speed = avg_speed
            else:
                final_speed = 0.0
        else:
            if avg_speed < self.stationary_enter_threshold:
                state["is_stationary"] = True
                final_speed = 0.0
            else:
                final_speed = avg_speed

        final_speed = max(0.0, final_speed)

        state["last_world_x"] = world_x
        state["last_world_y"] = world_y
        state["last_time"] = media_time

        is_overspeed = final_speed > (self.speed_limit + self.tolerance)

        return {
            "speed": round(final_speed, 1),
            "velocity": round(vy_kmh, 1),
            "is_overspeed": is_overspeed
        }

    def reset(self) -> None:
        self.history.clear()


def compute_homography_from_calibration(calibration: Any) -> Optional[List[float]]:
    """
    Computes a 3x3 homography matrix (9 elements) mapping normalized image coordinates [0, 1]
    to physical ground-plane coordinates in meters.
    Validates that:
    1. Exactly 4 points are supplied.
    2. Reference width and reference height in meters are positive numbers.
    3. Points form a valid non-degenerate transform.
    """
    if not calibration or not isinstance(calibration, dict):
        return None

    # Case 1: Homography matrix already provided directly
    if "homography_matrix" in calibration and isinstance(calibration["homography_matrix"], (list, tuple)):
        try:
            h = [float(v) for v in calibration["homography_matrix"]]
            if len(h) == 9:
                import numpy as np
                det = float(np.linalg.det(np.array(h, dtype=np.float64).reshape((3, 3))))
                if abs(det) > 1e-9 and not math.isnan(det) and not math.isinf(det):
                    return h
        except Exception:
            pass

    # Case 2: 4 points and reference dimensions
    pts_raw = (
        calibration.get("calibrationArea") or
        calibration.get("calibration_area") or
        calibration.get("points") or
        calibration.get("corners")
    )
    if not pts_raw or len(pts_raw) != 4:
        return None

    ref_w = (
        calibration.get("referenceWidth") or
        calibration.get("reference_width") or
        calibration.get("width")
    )
    ref_h = (
        calibration.get("referenceHeight") or
        calibration.get("reference_height") or
        calibration.get("height")
    )

    try:
        ref_w = float(ref_w)
        ref_h = float(ref_h)
    except (TypeError, ValueError):
        return None

    if ref_w <= 0.0 or ref_h <= 0.0:
        return None

    # Parse 4 source points
    norm_pts: List[Tuple[float, float]] = []
    for p in pts_raw:
        if isinstance(p, dict) and "x" in p and "y" in p:
            norm_pts.append((float(p["x"]), float(p["y"])))
        elif isinstance(p, (list, tuple)) and len(p) >= 2:
            norm_pts.append((float(p[0]), float(p[1])))
        else:
            return None

    if len(norm_pts) != 4:
        return None

    import numpy as np
    import cv2

    src = np.array(norm_pts, dtype=np.float32)
    # Order: Top-Left, Top-Right, Bottom-Right, Bottom-Left
    dst = np.array([
        [0.0, 0.0],
        [ref_w, 0.0],
        [ref_w, ref_h],
        [0.0, ref_h]
    ], dtype=np.float32)

    try:
        matrix = cv2.getPerspectiveTransform(src, dst)
        if matrix is None:
            return None
        det = float(np.linalg.det(matrix))
        if abs(det) < 1e-9 or math.isnan(det) or math.isinf(det):
            return None
        return matrix.flatten().tolist()
    except Exception:
        return None

