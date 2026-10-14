from typing import Dict, List, Any, Optional
import math

class TrackInterpolator:
    """
    Motion-aware temporal track interpolator for Fast Processing.
    Generates intermediate frame track positions between sampled inference frames
    using bilateral linear interpolation and conservative unilateral motion prediction.
    """

    def __init__(
        self,
        max_displacement_px: float = 150.0,
        enable_unilateral_prediction: bool = True,
        max_prediction_distance_px: float = 80.0
    ):
        self.max_displacement_px = max_displacement_px
        self.enable_unilateral_prediction = enable_unilateral_prediction
        self.max_prediction_distance_px = max_prediction_distance_px

    def interpolate(
        self,
        prev_tracks: List[Dict[str, Any]],
        next_tracks: List[Dict[str, Any]],
        prev_time: float,
        next_time: float,
        target_time: float,
        frame_width: Optional[int] = None,
        frame_height: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Interpolates track positions at target_time given anchor frames at prev_time and next_time.
        Requires prev_time <= target_time <= next_time.
        """
        duration = next_time - prev_time
        if duration <= 1e-6:
            alpha = 0.5
        else:
            alpha = max(0.0, min(1.0, (target_time - prev_time) / duration))

        next_tracks_by_id = {t["track_id"]: t for t in next_tracks}
        prev_tracks_by_id = {t["track_id"]: t for t in prev_tracks}

        interpolated_tracks: List[Dict[str, Any]] = []
        matched_prev_ids = set()

        # 1. Bilateral interpolation for tracks observed in both anchor frames
        for prev_t in prev_tracks:
            tid = prev_t["track_id"]
            if tid in next_tracks_by_id:
                matched_prev_ids.add(tid)
                next_t = next_tracks_by_id[tid]

                # Class consistency guard: do not interpolate across mismatched vehicle classes
                if prev_t.get("class_name") != next_t.get("class_name"):
                    continue

                dx = next_t["x"] - prev_t["x"]
                dy = next_t["y"] - prev_t["y"]
                disp = math.sqrt(dx * dx + dy * dy)

                # Motion continuity guard: reject large displacement jumps (> max_displacement_px)
                if disp > self.max_displacement_px:
                    continue

                interp_x = prev_t["x"] + alpha * dx
                interp_y = prev_t["y"] + alpha * dy
                interp_w = prev_t["w"] + alpha * (next_t["w"] - prev_t["w"])
                interp_h = prev_t["h"] + alpha * (next_t["h"] - prev_t["h"])

                # Guard against non-positive dimensions
                if interp_w <= 0.0 or interp_h <= 0.0:
                    continue

                # Speed and velocity interpolation
                p_spd = prev_t.get("speed")
                n_spd = next_t.get("speed")
                if p_spd is not None and n_spd is not None:
                    interp_speed = round(p_spd + alpha * (n_spd - p_spd), 1)
                elif p_spd is not None:
                    interp_speed = p_spd
                else:
                    interp_speed = n_spd

                p_vel = prev_t.get("velocity")
                n_vel = next_t.get("velocity")
                if p_vel is not None and n_vel is not None:
                    interp_velocity = round(p_vel + alpha * (n_vel - p_vel), 1)
                elif p_vel is not None:
                    interp_velocity = p_vel
                else:
                    interp_velocity = n_vel

                # Detector confidence preserved from anchors
                det_prob = round(min(prev_t.get("prob", 0.0), next_t.get("prob", 0.0)), 4)
                # Prediction confidence: 1.0 near endpoints, smoothly decaying to 0.90 at midpoint
                pred_quality = round(1.0 - 0.1 * (1.0 - 2.0 * abs(alpha - 0.5)), 3)

                interp_dx = None
                if prev_t.get("dx") is not None and next_t.get("dx") is not None:
                    interp_dx = round(prev_t["dx"] + alpha * (next_t["dx"] - prev_t["dx"]), 2)

                interp_dy = None
                if prev_t.get("dy") is not None and next_t.get("dy") is not None:
                    interp_dy = round(prev_t["dy"] + alpha * (next_t["dy"] - prev_t["dy"]), 2)

                state = "Confirmed" if (prev_t.get("state") == "Confirmed" or next_t.get("state") == "Confirmed") else "Tentative"
                is_overspeed = bool(prev_t.get("is_overspeed") or next_t.get("is_overspeed"))

                interpolated_tracks.append({
                    "track_id": tid,
                    "x": round(interp_x, 2),
                    "y": round(interp_y, 2),
                    "w": round(interp_w, 2),
                    "h": round(interp_h, 2),
                    "dx": interp_dx,
                    "dy": interp_dy,
                    "prob": det_prob,
                    "class_id": prev_t.get("class_id", next_t.get("class_id")),
                    "class_name": prev_t.get("class_name", next_t.get("class_name")),
                    "speed": interp_speed,
                    "velocity": interp_velocity,
                    "is_overspeed": is_overspeed,
                    "state": state,
                    "observation_type": "interpolated",
                    "prediction_confidence": pred_quality,
                    "time_since_update": 0
                })

        # 2. Conservative unilateral motion prediction for lost tracks
        if self.enable_unilateral_prediction:
            for prev_t in prev_tracks:
                tid = prev_t["track_id"]
                if tid in matched_prev_ids:
                    continue

                # Only predict for confirmed tracks that had a fresh detection in the previous anchor frame
                if prev_t.get("state") != "Confirmed":
                    continue
                if prev_t.get("time_since_update", 0) > 0:
                    continue

                dx = prev_t.get("dx", 0.0) or 0.0
                dy = prev_t.get("dy", 0.0) or 0.0
                vel_mag = math.sqrt(dx * dx + dy * dy)

                if vel_mag > self.max_prediction_distance_px:
                    continue

                # Step prediction by alpha * 1 frame equivalent (assuming alpha represents 1 step ahead)
                pred_x = prev_t["x"] + dx * alpha
                pred_y = prev_t["y"] + dy * alpha
                pred_w = prev_t["w"]
                pred_h = prev_t["h"]

                # Boundary check: reject if box drifted outside frame
                if frame_width is not None and frame_height is not None:
                    if pred_x < 0 or pred_x > frame_width or pred_y < 0 or pred_y > frame_height:
                        continue

                interpolated_tracks.append({
                    "track_id": tid,
                    "x": round(pred_x, 2),
                    "y": round(pred_y, 2),
                    "w": round(pred_w, 2),
                    "h": round(pred_h, 2),
                    "dx": round(dx, 2),
                    "dy": round(dy, 2),
                    "prob": round(prev_t.get("prob", 0.0), 4),
                    "class_id": prev_t.get("class_id"),
                    "class_name": prev_t.get("class_name"),
                    "speed": prev_t.get("speed"),
                    "velocity": prev_t.get("velocity"),
                    "is_overspeed": bool(prev_t.get("is_overspeed")),
                    "state": prev_t.get("state", "Confirmed"),
                    "observation_type": "predicted",
                    "prediction_confidence": 0.50,
                    "time_since_update": 1
                })

        return interpolated_tracks
