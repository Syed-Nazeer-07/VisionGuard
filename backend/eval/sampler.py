"""
VisionGuard Frame Sampler
Extracts representative frames from the local traffic video assets/car-detection.mp4
covering:
- Small/distant vehicles
- Dense traffic and congestion
- Occluded vehicles and boundary cars
- Trucks, buses, motorcycles
- Shadow/reflection variations
- Distributed across the 5.1-minute (9,184 frame) duration
"""

import json
from pathlib import Path
from typing import List, Dict, Any
import cv2

VIDEO_PATH = Path("assets/car-detection.mp4")
OUTPUT_DIR = Path("backend/eval/dataset/images")
METADATA_PATH = Path("backend/eval/dataset/metadata.json")

def generate_sample_plan(total_frames: int, fps: float) -> List[Dict[str, Any]]:
    """
    Selects 120 representative frames across the entire video.
    Covers diverse timestamps and traffic conditions.
    """
    plan: List[Dict[str, Any]] = []

    # Defined candidate frame ranges based on video scanning:
    # 1. Early section (frames 100 - 1800): initial flow, light to heavy, trucks appear
    early_frames = [
        (100, ["light_flow", "clear_weather"]),
        (250, ["distant_vehicles", "lane_transition"]),
        (400, ["small_vehicles", "horizon"]),
        (550, ["shadows", "moderate_flow"]),
        (700, ["truck_present", "moderate_flow"]),
        (850, ["truck_present", "distant_vehicles"]),
        (950, ["bus_present", "dense_traffic"]),
        (1050, ["bus_present", "truck_present", "dense_traffic"]),
        (1150, ["heavy_traffic", "boundary_vehicles"]),
        (1250, ["truck_present", "dense_traffic"]),
        (1350, ["bus_present", "truck_present", "dense_traffic", "overlapping_vehicles"]),
        (1450, ["truck_present", "dense_traffic"]),
        (1550, ["truck_present", "shadows"]),
        (1650, ["dense_traffic", "multi_lane_cluster", "occluded_vehicles"]),
        (1750, ["truck_present", "dense_traffic"]),
    ]

    # 2. Mid-early section (frames 1800 - 3600): lane clustering, bridge shadows, trucks
    mid_early_frames = [
        (1900, ["bus_present", "dense_traffic"]),
        (2050, ["truck_present", "lane_merging"]),
        (2150, ["distant_vehicles", "fast_flow"]),
        (2250, ["bus_present", "truck_present"]),
        (2380, ["shadows", "reflections"]),
        (2500, ["boundary_vehicles", "sparse_flow"]),
        (2650, ["light_traffic", "high_speed"]),
        (2800, ["distant_vehicles", "light_flow"]),
        (2950, ["sparse_flow", "shadows"]),
        (3100, ["truck_present", "moderate_flow"]),
        (3250, ["truck_present", "distant_vehicles"]),
        (3400, ["bus_present", "truck_present"]),
        (3550, ["dense_traffic", "overlapping_vehicles"]),
    ]

    # 3. Middle section (frames 3600 - 5400): variable traffic density, trucks & buses
    middle_frames = [
        (3700, ["truck_present", "moderate_flow"]),
        (3850, ["small_vehicles", "horizon"]),
        (4000, ["bus_present", "lane_cluster"]),
        (4150, ["truck_present", "shadows"]),
        (4300, ["dense_traffic", "occluded_vehicles"]),
        (4450, ["truck_present", "boundary_vehicles"]),
        (4600, ["distant_vehicles", "moderate_flow"]),
        (4750, ["truck_present", "shadows"]),
        (4900, ["light_traffic", "clear_road"]),
        (5050, ["dense_traffic", "multi_lane"]),
        (5200, ["bus_present", "truck_present"]),
        (5350, ["dense_traffic", "peak_congestion", "overlapping_vehicles"]),
    ]

    # 4. Peak density section (frames 5400 - 7200): heavy traffic, multi-lane congestion, close following
    peak_frames = [
        (5400, ["peak_density", "occluded_vehicles", "overlapping_vehicles"]),
        (5500, ["dense_traffic", "truck_present"]),
        (5600, ["dense_traffic", "boundary_vehicles"]),
        (5700, ["peak_density", "distant_vehicles", "overlapping_vehicles"]),
        (5800, ["bus_present", "truck_present", "dense_traffic"]),
        (5900, ["dense_traffic", "multi_lane_cluster"]),
        (6000, ["truck_present", "dense_traffic"]),
        (6150, ["truck_present", "shadows"]),
        (6300, ["bus_present", "moderate_flow"]),
        (6450, ["dense_traffic", "boundary_vehicles"]),
        (6600, ["truck_present", "lane_merging"]),
        (6750, ["distant_vehicles", "moderate_flow"]),
        (6900, ["light_flow", "clear_path"]),
        (7050, ["truck_present", "light_flow"]),
    ]

    # 5. Late section (frames 7200 - 9100): evening light shift, reflections, scattered flow
    late_frames = [
        (7200, ["light_shift", "shadows", "moderate_flow"]),
        (7350, ["truck_present", "distant_vehicles"]),
        (7500, ["moderate_flow", "boundary_vehicles"]),
        (7650, ["truck_present", "shadows"]),
        (7800, ["distant_vehicles", "reflections"]),
        (7950, ["dense_traffic", "multi_lane"]),
        (8100, ["truck_present", "light_traffic"]),
        (8250, ["moderate_flow", "clear_view"]),
        (8400, ["truck_present", "shadows"]),
        (8550, ["boundary_vehicles", "light_flow"]),
        (8700, ["distant_vehicles", "light_flow"]),
        (8850, ["moderate_flow", "reflections"]),
        (9000, ["truck_present", "tail_traffic"]),
    ]

    combined = early_frames + mid_early_frames + middle_frames + peak_frames + late_frames

    # Add systematic interleaved steps to bring total to 120 frames uniformly across video
    frame_indices_set = {f[0] for f in combined}
    step = int(total_frames / (120 - len(combined)))
    for idx in range(50, total_frames - 50, step):
        if idx not in frame_indices_set and len(combined) < 120:
            combined.append((idx, ["systematic_sample"]))
            frame_indices_set.add(idx)

    # Sort in ascending chronological order
    combined.sort(key=lambda x: x[0])

    for rank, (f_idx, tags) in enumerate(combined[:120]):
        time_sec = round(f_idx / fps, 3)
        plan.append({
            "sample_id": f"sample_{rank:03d}",
            "frame_index": f_idx,
            "timestamp_seconds": time_sec,
            "image_filename": f"frame_{f_idx:05d}.jpg",
            "tags": tags,
            "width": 1920,
            "height": 1080
        })

    return plan

def run_sampler():
    if not VIDEO_PATH.exists():
        raise FileNotFoundError(f"Video file not found: {VIDEO_PATH}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(VIDEO_PATH))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)

    plan = generate_sample_plan(total_frames, fps)
    print(f"Generated sample plan with {len(plan)} frames across {total_frames} total frames.")

    saved_count = 0
    for item in plan:
        f_idx = item["frame_index"]
        out_file = OUTPUT_DIR / item["image_filename"]

        cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
        ret, frame = cap.read()
        if not ret:
            print(f"Warning: Could not read frame {f_idx}")
            continue

        # Save as high-quality JPEG
        cv2.imwrite(str(out_file), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
        saved_count += 1

    cap.release()

    # Save metadata
    with open(METADATA_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "video_source": str(VIDEO_PATH),
            "total_frames_in_source": total_frames,
            "source_fps": fps,
            "sampled_frames_count": saved_count,
            "samples": plan
        }, f, indent=2)

    print(f"Successfully saved {saved_count} frames to {OUTPUT_DIR}")
    print(f"Saved dataset metadata to {METADATA_PATH}")

if __name__ == "__main__":
    run_sampler()
