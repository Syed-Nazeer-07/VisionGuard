from pathlib import Path
from typing import Dict, List, Any, Optional, Callable
import time
import cv2

from app.pipeline.detector import YOLODetector
from app.pipeline.tracker import ByteTracker
from app.pipeline.interpolator import TrackInterpolator
from app.pipeline.speed import SpeedEstimator
from app.config import settings
from app.core.logging import logger

class VideoProcessor:
    def __init__(self, detector: Optional[YOLODetector] = None):
        self.detector = detector or YOLODetector()

    def process_video(
        self,
        video_path: Path,
        job_id: str,
        is_cancelled: Callable[[], bool],
        progress_callback: Callable[[int, int, float, float], None],
        homography_matrix: Optional[List[float]] = None,
        frame_stride: int = 1,
        conf_threshold: Optional[float] = None,
        iou_threshold: Optional[float] = None,
        detection_profile: str = "balanced",
        processing_speed: str = "full"
    ) -> Dict[str, Any]:
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found at: {video_path}")

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise ValueError(f"OpenCV could not open video file: {video_path.name}")

        cv2.setNumThreads(settings.OPENCV_NUM_THREADS)

        try:
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            fps = float(cap.get(cv2.CAP_PROP_FPS))
            if fps <= 0 or not (0 < fps <= 240):
                fps = 30.0

            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if total_frames <= 0:
                total_frames = 1

            duration_seconds = total_frames / fps

            if width <= 0 or height <= 0:
                raise ValueError(f"Corrupt or empty video dimensions: {width}x{height}")

            # Initialize ByteTracker with track_threshold aligned to detection profile (>= 0.45 for track initiation)
            eff_track_th = max(0.45, conf_threshold or settings.CONFIDENCE_THRESHOLD)
            tracker = ByteTracker(track_threshold=eff_track_th)
            interpolator = TrackInterpolator()
            speed_estimator = SpeedEstimator(homography_matrix=homography_matrix)

            frame_records: List[Dict[str, Any]] = []
            prev_sampled_record: Optional[Dict[str, Any]] = None
            pending_skipped_frames: List[Dict[str, Any]] = []
            unique_tracks = set()
            vehicle_track_classes: Dict[int, Dict[str, int]] = {}
            max_vehicles_in_frame = 0
            speed_violations_count = 0
            speeds_recorded: List[float] = []

            # Resolve frame_stride: fast processing uses stride 2
            if processing_speed == "fast" and frame_stride <= 1:
                frame_stride = 2

            frame_idx = 0
            processed_count = 0
            start_wall_time = time.time()
            last_progress_update = 0.0

            while True:
                if is_cancelled():
                    logger.info(f"Analysis processing cancelled for job {job_id}")
                    raise InterruptedError("Job processing was cancelled by user")

                frame_idx += 1

                # Frame stride sampling: skip pixel decoding with cap.grab() for unanalyzed frames
                if frame_stride > 1 and ((frame_idx - 1) % frame_stride != 0):
                    if not cap.grab():
                        break
                    pos_msec = cap.get(cv2.CAP_PROP_POS_MSEC)
                    if pos_msec is not None and pos_msec >= 0:
                        skip_time = pos_msec / 1000.0
                    else:
                        skip_time = (frame_idx - 1) / fps
                    pending_skipped_frames.append({
                        "frame_id": frame_idx,
                        "media_time": round(skip_time, 4)
                    })
                    continue

                ret, frame = cap.read()
                if not ret or frame is None:
                    break

                processed_count += 1

                # Accurate presentation timestamp
                pos_msec = cap.get(cv2.CAP_PROP_POS_MSEC)
                if pos_msec is not None and pos_msec >= 0:
                    media_time = pos_msec / 1000.0
                else:
                    media_time = (frame_idx - 1) / fps

                # Run YOLO detection with job-specific detection profile thresholds
                raw_boxes = self.detector.detect(frame, conf_threshold=conf_threshold, iou_threshold=iou_threshold)

                # Run tracker
                tracks = tracker.update(raw_boxes)

                # Run speed estimation & violations
                active_vehicles = 0
                for t in tracks:
                    track_id = t["track_id"]
                    cname = t["class_name"]

                    if cname in ("car", "truck", "bus", "motorcycle", "bicycle"):
                        unique_tracks.add(track_id)
                        if track_id not in vehicle_track_classes:
                            vehicle_track_classes[track_id] = {}
                        vehicle_track_classes[track_id][cname] = vehicle_track_classes[track_id].get(cname, 0) + 1
                        active_vehicles += 1

                        # Speed update if calibrated
                        speed_res = speed_estimator.update(
                            track_id=track_id,
                            box_cx=t["x"],
                            box_cy=t["y"],
                            box_w=t["w"],
                            box_h=t["h"],
                            media_time=media_time,
                            norm_width=width,
                            norm_height=height
                        )

                        if speed_res:
                            t["speed"] = speed_res["speed"]
                            t["velocity"] = speed_res["velocity"]
                            t["is_overspeed"] = speed_res["is_overspeed"]
                            if speed_res["is_overspeed"]:
                                speed_violations_count += 1
                            if speed_res["speed"] is not None:
                                speeds_recorded.append(speed_res["speed"])
                        else:
                            t["speed"] = None
                            t["velocity"] = None
                            t["is_overspeed"] = False
                    else:
                        t["speed"] = None
                        t["velocity"] = None
                        t["is_overspeed"] = False

                max_vehicles_in_frame = max(max_vehicles_in_frame, active_vehicles)

                current_sampled_record = {
                    "frame_id": frame_idx,
                    "media_time": round(media_time, 4),
                    "source_width": width,
                    "source_height": height,
                    "boxes": [b.to_dict() for b in raw_boxes],
                    "tracks": tracks,
                    "detection_count": len(raw_boxes)
                }

                # Interpolate pending intermediate frames between consecutive sampled anchors
                if pending_skipped_frames:
                    if prev_sampled_record is not None:
                        for skipped in pending_skipped_frames:
                            interp_tracks = interpolator.interpolate(
                                prev_tracks=prev_sampled_record["tracks"],
                                next_tracks=tracks,
                                prev_time=prev_sampled_record["media_time"],
                                next_time=media_time,
                                target_time=skipped["media_time"],
                                frame_width=width,
                                frame_height=height
                            )
                            frame_records.append({
                                "frame_id": skipped["frame_id"],
                                "media_time": skipped["media_time"],
                                "source_width": width,
                                "source_height": height,
                                "boxes": [],
                                "tracks": interp_tracks,
                                "detection_count": 0
                            })
                    pending_skipped_frames.clear()

                frame_records.append(current_sampled_record)
                prev_sampled_record = current_sampled_record

                # Report progress throttled to ~4 times per second or on completion
                now = time.time()
                if now - last_progress_update >= 0.25:
                    elapsed = now - start_wall_time
                    processing_fps = processed_count / elapsed if elapsed > 0 else 0.0
                    progress_callback(frame_idx, total_frames, elapsed, processing_fps)
                    last_progress_update = now

            # If trailing skipped frames remain after last sampled frame at EOF:
            if pending_skipped_frames and prev_sampled_record is not None:
                for skipped in pending_skipped_frames:
                    pred_tracks = interpolator.interpolate(
                        prev_tracks=prev_sampled_record["tracks"],
                        next_tracks=[],
                        prev_time=prev_sampled_record["media_time"],
                        next_time=skipped["media_time"] + (1.0 / fps),
                        target_time=skipped["media_time"],
                        frame_width=width,
                        frame_height=height
                    )
                    frame_records.append({
                        "frame_id": skipped["frame_id"],
                        "media_time": skipped["media_time"],
                        "source_width": width,
                        "source_height": height,
                        "boxes": [],
                        "tracks": pred_tracks,
                        "detection_count": 0
                    })
                pending_skipped_frames.clear()

            elapsed_total = time.time() - start_wall_time
            final_processing_fps = processed_count / elapsed_total if elapsed_total > 0 else 0.0
            progress_callback(frame_idx, total_frames, elapsed_total, final_processing_fps)

            avg_speed = round(sum(speeds_recorded) / len(speeds_recorded), 1) if speeds_recorded else None

            # Calculate unique vehicle counts strictly across traffic vehicle classes
            unique_vehicle_counts_by_class: Dict[str, int] = {}
            for tid, c_dict in vehicle_track_classes.items():
                if c_dict:
                    best_cls = max(c_dict.items(), key=lambda x: x[1])[0]
                    unique_vehicle_counts_by_class[best_cls] = unique_vehicle_counts_by_class.get(best_cls, 0) + 1

            summary = {
                "total_frames": total_frames,
                "processed_frames": processed_count,
                "duration_seconds": round(duration_seconds, 2),
                "unique_vehicles": len(unique_tracks),
                "vehicle_counts_by_class": unique_vehicle_counts_by_class,
                "max_vehicles_in_frame": max_vehicles_in_frame,
                "average_speed_kmh": avg_speed,
                "speed_violations_count": speed_violations_count,
                "detection_profile": detection_profile,
                "confidence_threshold": round(conf_threshold if conf_threshold is not None else settings.CONFIDENCE_THRESHOLD, 2),
                "iou_threshold": round(iou_threshold if iou_threshold is not None else settings.IOU_THRESHOLD, 2),
                "processing_speed": processing_speed,
                "frame_stride": frame_stride,
                "is_calibrated": speed_estimator.is_calibrated
            }

            video_metadata = {
                "width": width,
                "height": height,
                "fps": round(fps, 2),
                "total_frames": total_frames,
                "duration_seconds": round(duration_seconds, 2)
            }

            return {
                "video_metadata": video_metadata,
                "summary": summary,
                "frames": frame_records
            }
        finally:
            cap.release()
