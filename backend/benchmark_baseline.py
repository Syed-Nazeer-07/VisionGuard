import sys
import time
from pathlib import Path
from typing import Optional, Dict, Any

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

import cv2
import numpy as np
import onnxruntime as ort

from app.config import settings
from app.pipeline.detector import YOLODetector
from app.pipeline.tracker import ByteTracker
from app.pipeline.speed import SpeedEstimator
from app.storage.artifact import artifact_manager

def run_benchmark(
    video_path: str = "assets/car-detection.mp4",
    max_frames: int = 300,
    job_id: str = "benchmark-job",
    provider_override: Optional[str] = None
) -> Dict[str, Any]:
    v_path = Path(video_path).resolve()
    if not v_path.exists():
        raise FileNotFoundError(f"Video not found: {v_path}")

    cap = cv2.VideoCapture(str(v_path))
    if not cap.isOpened():
        raise RuntimeError("Failed to open video")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
    total_video_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Apply provider override if requested
    if provider_override:
        settings.PREFERRED_EXECUTION_PROVIDER = provider_override

    detector = YOLODetector()
    tracker = ByteTracker()
    cv2.setNumThreads(settings.OPENCV_NUM_THREADS)

    total_decode_time = 0.0
    total_preprocess_time = 0.0
    total_inference_time = 0.0
    total_postprocess_time = 0.0
    total_tracking_time = 0.0
    total_serialization_time = 0.0

    frame_records = []
    unique_tracks = set()
    class_counts = {}
    max_concurrent_vehicles = 0
    total_detections = 0

    print(f"\n{'='*55}")
    print(f"  RUNNING BENCHMARK: {detector.active_provider}")
    print(f"  Video: {v_path.name} (1920x1080 @ {fps:.1f} FPS) | Frames: {max_frames}")
    print(f"{'='*55}")

    start_wall_time = time.perf_counter()

    for frame_idx in range(1, max_frames + 1):
        # 1. Frame Decode
        t0 = time.perf_counter()
        ret, frame = cap.read()
        t1 = time.perf_counter()
        total_decode_time += (t1 - t0)

        if not ret or frame is None:
            break

        media_time = frame_idx / fps

        # 2. Preprocess (measure letterbox + direct copy + normalization into _input_tensor)
        t0 = time.perf_counter()
        target_size = detector.input_size
        ratio = min(target_size / width, target_size / height)
        scaled_w = max(1, int(round(width * ratio)))
        scaled_h = max(1, int(round(height * ratio)))
        pad_w = int(round((target_size - scaled_w) / 2.0))
        pad_h = int(round((target_size - scaled_h) / 2.0))

        geom = (scaled_w, scaled_h, pad_w, pad_h)
        if detector._last_pad_geometry != geom:
            detector._padded_buffer.fill(114)
            detector._last_pad_geometry = geom

        resized = cv2.resize(frame, (scaled_w, scaled_h), interpolation=cv2.INTER_LINEAR)
        rgb_resized = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        detector._padded_buffer[pad_h:pad_h + scaled_h, pad_w:pad_w + scaled_w] = rgb_resized
        np.divide(detector._padded_buffer.transpose(2, 0, 1), 255.0, out=detector._input_tensor[0])
        t1 = time.perf_counter()
        total_preprocess_time += (t1 - t0)

        # 3. ONNX Inference
        t0 = time.perf_counter()
        outputs = detector.session.run([detector.output_name], {detector.input_name: detector._input_tensor})
        raw_output = outputs[0]
        t1 = time.perf_counter()
        total_inference_time += (t1 - t0)

        # 4. Postprocess & NMS
        t0 = time.perf_counter()
        predictions = np.transpose(np.squeeze(raw_output, axis=0))
        boxes = predictions[:, :4]
        scores = predictions[:, 4:]
        max_probs = np.max(scores, axis=1)
        class_ids = np.argmax(scores, axis=1)

        from app.pipeline.detector import ALLOWED_CLASSES_ARR, COCO_LABELS, RawDetection
        conf_th = settings.CONFIDENCE_THRESHOLD
        iou_th = settings.IOU_THRESHOLD

        mask = (max_probs >= conf_th) & np.isin(class_ids, ALLOWED_CLASSES_ARR)
        valid_indices = np.flatnonzero(mask)

        raw_boxes = []
        if len(valid_indices) > 0:
            v_boxes = boxes[valid_indices]
            v_probs = max_probs[valid_indices]
            tl_x = v_boxes[:, 0] - v_boxes[:, 2] * 0.5
            tl_y = v_boxes[:, 1] - v_boxes[:, 3] * 0.5
            boxes_for_nms = np.column_stack((tl_x, tl_y, v_boxes[:, 2], v_boxes[:, 3])).tolist()
            probs_for_nms = v_probs.tolist()

            indices = cv2.dnn.NMSBoxes(boxes_for_nms, probs_for_nms, conf_th, iou_th)
            if len(indices) > 0:
                selected_indices = indices.flatten() if hasattr(indices, "flatten") else [int(i[0]) for i in indices]
                for i in selected_indices:
                    orig_idx = valid_indices[i]
                    cx, cy, w, h = boxes[orig_idx]
                    src_cx = max(0.0, min(float(width), float((cx - pad_w) / ratio)))
                    src_cy = max(0.0, min(float(height), float((cy - pad_h) / ratio)))
                    src_w = max(1.0, min(float(width), float(w / ratio)))
                    src_h = max(1.0, min(float(height), float(h / ratio)))
                    cid = int(class_ids[orig_idx])
                    cname = COCO_LABELS[cid] if cid < len(COCO_LABELS) else f"class_{cid}"
                    prob = float(max_probs[orig_idx])
                    raw_boxes.append(RawDetection(src_cx, src_cy, src_w, src_h, prob, cid, cname))

        t1 = time.perf_counter()
        total_postprocess_time += (t1 - t0)
        total_detections += len(raw_boxes)

        # 5. Tracking Pipeline
        t0 = time.perf_counter()
        tracks = tracker.update(raw_boxes)
        active_vehicles = 0
        for t in tracks:
            track_id = t["track_id"]
            unique_tracks.add(track_id)
            cname = t["class_name"]
            class_counts[cname] = class_counts.get(cname, 0) + 1
            if cname in ("car", "truck", "bus", "motorcycle"):
                active_vehicles += 1
            t["speed"] = None
            t["velocity"] = None
            t["is_overspeed"] = False

        max_concurrent_vehicles = max(max_concurrent_vehicles, active_vehicles)
        t1 = time.perf_counter()
        total_tracking_time += (t1 - t0)

        # In-memory record
        frame_records.append({
            "frame_id": frame_idx,
            "media_time": round(media_time, 4),
            "source_width": width,
            "source_height": height,
            "boxes": [b.to_dict() for b in raw_boxes],
            "tracks": tracks,
            "detection_count": len(raw_boxes)
        })

        if frame_idx % 50 == 0 or frame_idx == max_frames:
            elapsed = time.perf_counter() - start_wall_time
            cur_fps = frame_idx / elapsed
            print(f"  Frame {frame_idx}/{max_frames} ({frame_idx/max_frames*100:.1f}%) | Elapsed: {elapsed:.2f}s | Current: {cur_fps:.2f} FPS")

    cap.release()

    # 6. Gzip Serialization
    t0 = time.perf_counter()
    summary = {
        "total_frames": max_frames,
        "processed_frames": len(frame_records),
        "duration_seconds": round(max_frames / fps, 2),
        "unique_vehicles": len(unique_tracks),
        "vehicle_counts_by_class": class_counts,
        "max_vehicles_in_frame": max_concurrent_vehicles,
        "average_speed_kmh": None,
        "speed_violations_count": 0
    }
    video_metadata = {
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "total_frames": max_frames,
        "duration_seconds": round(max_frames / fps, 2)
    }
    artifact_path = artifact_manager.write_artifact(
        job_id=job_id,
        video_metadata=video_metadata,
        summary=summary,
        frames=frame_records
    )
    t1 = time.perf_counter()
    total_serialization_time = (t1 - t0)

    total_wall_time = time.perf_counter() - start_wall_time
    effective_fps = len(frame_records) / total_wall_time if total_wall_time > 0 else 0.0

    print("\n" + "="*55)
    print(f"       BENCHMARK REPORT: {detector.active_provider}")
    print("="*55)
    print(f"Total Frames Processed : {len(frame_records)}")
    print(f"Total Wall Duration    : {total_wall_time:.3f} s")
    print(f"Effective Throughput   : {effective_fps:.2f} FPS")
    print("-" * 55)
    print("STAGE-BY-STAGE TIMING BREAKDOWN:")
    print(f"  1. Frame Decoding     : {total_decode_time:.3f} s  ({(total_decode_time/total_wall_time)*100:.1f}%)  [{total_decode_time/len(frame_records)*1000:.2f} ms/frame]")
    print(f"  2. Preprocessing      : {total_preprocess_time:.3f} s  ({(total_preprocess_time/total_wall_time)*100:.1f}%)  [{total_preprocess_time/len(frame_records)*1000:.2f} ms/frame]")
    print(f"  3. ONNX Inference     : {total_inference_time:.3f} s  ({(total_inference_time/total_wall_time)*100:.1f}%)  [{total_inference_time/len(frame_records)*1000:.2f} ms/frame]")
    print(f"  4. Postprocess & NMS  : {total_postprocess_time:.3f} s  ({(total_postprocess_time/total_wall_time)*100:.1f}%)  [{total_postprocess_time/len(frame_records)*1000:.2f} ms/frame]")
    print(f"  5. Tracking Pipeline  : {total_tracking_time:.3f} s  ({(total_tracking_time/total_wall_time)*100:.1f}%)  [{total_tracking_time/len(frame_records)*1000:.2f} ms/frame]")
    print(f"  6. Gzip Serialization : {total_serialization_time:.3f} s  ({(total_serialization_time/total_wall_time)*100:.1f}%)")
    print("-" * 55)
    print("ACCURACY & TRACKING METRICS:")
    print(f"  Total Raw Detections  : {total_detections}")
    print(f"  Unique Tracked IDs    : {len(unique_tracks)}")
    print(f"  Class Breakdown       : {class_counts}")
    print(f"  Peak Vehicles in Frame: {max_concurrent_vehicles}")
    print(f"  Artifact File Size    : {artifact_path.stat().st_size} bytes")
    print("="*55)

    artifact_manager.cleanup_artifacts(job_id)

    return {
        "provider": detector.active_provider,
        "total_wall_time": total_wall_time,
        "effective_fps": effective_fps,
        "decode_time": total_decode_time,
        "preprocess_time": total_preprocess_time,
        "inference_time": total_inference_time,
        "postprocess_time": total_postprocess_time,
        "tracking_time": total_tracking_time,
        "serialization_time": total_serialization_time,
        "total_detections": total_detections,
        "unique_tracks": len(unique_tracks),
        "class_counts": class_counts,
        "peak_vehicles": max_concurrent_vehicles
    }

if __name__ == "__main__":
    provider_arg = sys.argv[1] if len(sys.argv) > 1 else None
    run_benchmark(provider_override=provider_arg)
