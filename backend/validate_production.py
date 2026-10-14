import sys
import time
import os
import gzip
import json
from pathlib import Path
from typing import Dict, Any, List

backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

import cv2
import numpy as np
import onnxruntime as ort

from app.config import settings
from app.pipeline.detector import YOLODetector
from app.pipeline.tracker import ByteTracker
from app.pipeline.processor import VideoProcessor
from app.storage.artifact import artifact_manager

VIDEO_FILE = Path("assets/car-detection.mp4").resolve()

def benchmark_repeated_runs(provider: str, num_runs: int = 3, num_frames: int = 300) -> Dict[str, Any]:
    print(f"\n=======================================================")
    print(f"  REPEATED BENCHMARK: {provider} ({num_runs} runs x {num_frames} frames)")
    print(f"=======================================================")

    settings.PREFERRED_EXECUTION_PROVIDER = provider
    detector = YOLODetector()
    print(f"Model loaded: {detector.model_path.name} | Active Provider: {detector.active_provider}")

    # Explicit warm-up (5 frames) excluded from benchmark timings
    cap = cv2.VideoCapture(str(VIDEO_FILE))
    for _ in range(5):
        ret, frame = cap.read()
        if ret:
            detector.detect(frame)
    cap.release()

    run_durations: List[float] = []
    run_fps: List[float] = []
    run_detections: List[int] = []
    run_tracks: List[int] = []

    for run_i in range(1, num_runs + 1):
        cap = cv2.VideoCapture(str(VIDEO_FILE))
        tracker = ByteTracker()
        total_dets = 0
        unique_ids = set()

        t0 = time.perf_counter()
        for f_idx in range(1, num_frames + 1):
            ret, frame = cap.read()
            if not ret:
                break
            dets = detector.detect(frame)
            tracks = tracker.update(dets)
            total_dets += len(dets)
            for t in tracks:
                unique_ids.add(t["track_id"])
        t1 = time.perf_counter()
        cap.release()

        dur = t1 - t0
        fps = num_frames / dur if dur > 0 else 0.0
        run_durations.append(dur)
        run_fps.append(fps)
        run_detections.append(total_dets)
        run_tracks.append(len(unique_ids))
        print(f"  Run {run_i}: {dur:.3f} s | {fps:.2f} FPS | Detections: {total_dets} | Unique Tracks: {len(unique_ids)}")

    median_fps = float(np.median(run_fps))
    median_dur = float(np.median(run_durations))
    print(f"  --> Median Result: {median_dur:.3f} s ({median_fps:.2f} FPS)")

    return {
        "provider": detector.active_provider,
        "runs": num_runs,
        "frames": num_frames,
        "durations": run_durations,
        "fps_list": run_fps,
        "median_fps": median_fps,
        "median_duration": median_dur,
        "detections": run_detections[0],
        "unique_tracks": run_tracks[0]
    }

def validate_longer_video(num_frames: int = 1800, provider: str = "DmlExecutionProvider") -> Dict[str, Any]:
    print(f"\n=======================================================")
    print(f"  LONGER VIDEO VALIDATION: {num_frames} frames (60.0s @ 30 FPS)")
    print(f"  Provider: {provider}")
    print(f"=======================================================")

    settings.PREFERRED_EXECUTION_PROVIDER = provider
    detector = YOLODetector()
    processor = VideoProcessor(detector)

    job_id = f"long-val-{int(time.time())}"
    progress_reports = []

    def is_cancelled():
        return False

    def progress_cb(cur, tot, elap, proc_fps):
        progress_reports.append((cur, tot, elap, proc_fps))
        if cur % 300 == 0 or cur == num_frames:
            pct = (cur / num_frames) * 100
            print(f"  Progress: {cur}/{num_frames} ({pct:.1f}%) | Elapsed: {elap:.1f}s | Speed: {proc_fps:.1f} FPS")

    # Measure memory using process memory info if available
    try:
        import psutil
        proc = psutil.Process()
        mem_before = proc.memory_info().rss / (1024 * 1024)
    except Exception:
        mem_before = None

    t0 = time.perf_counter()
    # Process the first num_frames by custom stream loop or VideoProcessor
    cap = cv2.VideoCapture(str(VIDEO_FILE))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0

    tracker = ByteTracker()
    frame_records = []
    unique_tracks = set()
    class_counts = {}
    max_concurrent = 0

    last_prog = 0.0
    for frame_idx in range(1, num_frames + 1):
        ret, frame = cap.read()
        if not ret:
            break
        media_time = frame_idx / fps
        dets = detector.detect(frame)
        tracks = tracker.update(dets)

        active = 0
        for t in tracks:
            unique_tracks.add(t["track_id"])
            cname = t["class_name"]
            class_counts[cname] = class_counts.get(cname, 0) + 1
            if cname in ("car", "truck", "bus", "motorcycle"):
                active += 1
            t["speed"] = None
            t["velocity"] = None
            t["is_overspeed"] = False

        max_concurrent = max(max_concurrent, active)

        frame_records.append({
            "frame_id": frame_idx,
            "media_time": round(media_time, 4),
            "source_width": width,
            "source_height": height,
            "boxes": [b.to_dict() for b in dets],
            "tracks": tracks,
            "detection_count": len(dets)
        })

        now = time.perf_counter()
        if now - last_prog >= 0.25:
            elap = now - t0
            proc_fps = frame_idx / elap if elap > 0 else 0.0
            progress_cb(frame_idx, num_frames, elap, proc_fps)
            last_prog = now

    cap.release()
    t1 = time.perf_counter()
    total_duration = t1 - t0
    effective_fps = len(frame_records) / total_duration if total_duration > 0 else 0.0

    try:
        import psutil
        mem_after = proc.memory_info().rss / (1024 * 1024)
        mem_delta = mem_after - (mem_before or 0)
    except Exception:
        mem_after = None
        mem_delta = None

    # Write artifact and verify integrity
    summary = {
        "total_frames": num_frames,
        "processed_frames": len(frame_records),
        "duration_seconds": round(num_frames / fps, 2),
        "unique_vehicles": len(unique_tracks),
        "vehicle_counts_by_class": class_counts,
        "max_vehicles_in_frame": max_concurrent,
        "average_speed_kmh": None,
        "speed_violations_count": 0
    }
    video_meta = {
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "total_frames": num_frames,
        "duration_seconds": round(num_frames / fps, 2)
    }

    artifact_file = artifact_manager.write_artifact(
        job_id=job_id,
        video_metadata=video_meta,
        summary=summary,
        frames=frame_records
    )

    # Verify artifact readability & schema
    assert artifact_file.exists(), "Artifact file missing!"
    raw_bytes = artifact_file.read_bytes()
    decompressed = gzip.decompress(raw_bytes)
    data = json.loads(decompressed.decode("utf-8"))

    assert len(data["frames"]) == num_frames, f"Frame count mismatch in artifact: {len(data['frames'])} vs {num_frames}"
    assert data["summary"]["unique_vehicles"] == len(unique_tracks)
    # Verify timestamp monotonicity
    times = [f["media_time"] for f in data["frames"]]
    assert all(times[i] <= times[i+1] for i in range(len(times)-1)), "Timestamps not monotonic!"

    print(f"\n--- Validation Summary ---")
    print(f"Total Frames Processed : {len(frame_records)}")
    print(f"Total Duration         : {total_duration:.2f} s")
    print(f"Effective Throughput   : {effective_fps:.2f} FPS")
    print(f"Artifact Size (gzip)   : {len(raw_bytes):,} bytes ({len(decompressed):,} bytes uncompressed)")
    print(f"Unique Tracked Vehicles: {len(unique_tracks)}")
    print(f"Peak Concurrent Tracks : {max_concurrent}")
    print(f"Class Breakdown        : {class_counts}")
    if mem_after is not None:
        print(f"Memory RSS             : {mem_after:.1f} MB (growth: {mem_delta:+.1f} MB)")
    print(f"Artifact Gzip Integrity: VERIFIED (100% valid JSON, {len(data['frames'])} frames, monotonic timestamps)")

    artifact_manager.cleanup_artifacts(job_id)

    return {
        "processed_frames": len(frame_records),
        "duration_seconds": total_duration,
        "effective_fps": effective_fps,
        "unique_vehicles": len(unique_tracks),
        "peak_concurrent": max_concurrent,
        "artifact_size_bytes": len(raw_bytes),
        "memory_rss_mb": mem_after
    }

if __name__ == "__main__":
    # 1. Repeated 300-frame benchmarks
    bench_dml = benchmark_repeated_runs("DmlExecutionProvider", num_runs=3, num_frames=300)
    bench_cpu = benchmark_repeated_runs("CPUExecutionProvider", num_runs=3, num_frames=300)

    # 2. Longer 60-second video validation (1,800 frames)
    long_val = validate_longer_video(num_frames=1800, provider="DmlExecutionProvider")
