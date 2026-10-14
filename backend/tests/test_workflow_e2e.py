import asyncio
from pathlib import Path
import pytest
from httpx import AsyncClient
import cv2

@pytest.mark.asyncio
async def test_all_four_combinations_e2e(client: AsyncClient):
    # Check health
    health = await client.get("/api/v1/health")
    assert health.status_code == 200
    health_data = health.json()
    assert health_data["model_ready"] is True
    print(f"\nHealth verified: provider={health_data['execution_provider']}")

    video_path = Path("../assets/car-detection.mp4")
    assert video_path.exists(), "Source traffic video exists"

    # Create a 20-frame real test video from the first 20 frames of car-detection.mp4
    cap = cv2.VideoCapture(str(video_path))
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    clip_path = Path("test_clip_20f.mp4")
    out = cv2.VideoWriter(str(clip_path), fourcc, 30.0, (640, 360))
    for _ in range(20):
        ret, frame = cap.read()
        if not ret:
            break
        out.write(cv2.resize(frame, (640, 360)))
    cap.release()
    out.release()

    modes = [
        ("full", "balanced", False),
        ("full", "high_recall", True),
        ("fast", "balanced", False),
        ("fast", "high_recall", True),
    ]

    try:
        for speed, profile, save_hist in modes:
            with clip_path.open("rb") as f:
                files = {"video": ("test_clip.mp4", f, "video/mp4")}
                data = {
                    "processing_speed": speed,
                    "detection_profile": profile,
                    "save_to_history": str(save_hist).lower(),
                    "video_id": f"vid-{speed}-{profile}" if save_hist else ""
                }
                res = await client.post("/api/v1/analysis/jobs", files=files, data=data)
            assert res.status_code == 201, f"Create failed: {res.text}"
            job_info = res.json()
            job_id = job_info["job_id"]
            assert job_info["processing_speed"] == speed
            assert job_info["detection_profile"] == profile

            # Poll status until completed
            completed = False
            for _ in range(60):
                await asyncio.sleep(0.5)
                st_res = await client.get(f"/api/v1/analysis/jobs/{job_id}")
                assert st_res.status_code == 200
                st = st_res.json()
                if st["status"] == "completed":
                    completed = True
                    break
                elif st["status"] == "failed":
                    pytest.fail(f"Job failed: {st.get('error')}")

            assert completed, f"Job {job_id} did not complete"
            summary = st["summary"]
            assert summary is not None
            expected_proc = 10 if speed == "fast" else 20
            assert summary["processed_frames"] == expected_proc
            assert summary["processing_speed"] == speed
            assert summary["detection_profile"] == profile

            # Verify results slice endpoint
            results_res = await client.get(f"/api/v1/analysis/jobs/{job_id}/results?limit=5&offset=0")
            assert results_res.status_code == 200
            res_data = results_res.json()
            assert len(res_data["frames"]) == 5
            first_frame = res_data["frames"][0]
            assert "media_time" in first_frame
            assert "boxes" in first_frame
            assert "tracks" in first_frame

            # Verify artifact endpoint
            art_res = await client.get(f"/api/v1/analysis/jobs/{job_id}/artifact")
            assert art_res.status_code == 200
            assert art_res.headers["content-type"] == "application/gzip"

            print(f"  Mode ({speed} + {profile}, save={save_hist}): SUCCESS ({summary['processed_frames']}/{summary['total_frames']} frames, {summary['unique_vehicles']} vehicles)")
    finally:
        clip_path.unlink(missing_ok=True)
