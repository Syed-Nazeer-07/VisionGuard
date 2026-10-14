import asyncio
from pathlib import Path
import pytest
from httpx import AsyncClient

from app.services.job_manager import job_manager
from app.models.schemas import JobStatus

@pytest.mark.asyncio
async def test_unsupported_file_extension(client: AsyncClient):
    files = {"video": ("test.txt", b"plain text content", "text/plain")}
    response = await client.post("/api/v1/analysis/jobs", files=files)
    assert response.status_code == 400
    assert "Unsupported video format" in response.json()["detail"]

@pytest.mark.asyncio
async def test_corrupt_video_rejected(client: AsyncClient, corrupt_video: Path):
    with corrupt_video.open("rb") as f:
        files = {"video": ("corrupt.mp4", f, "video/mp4")}
        response = await client.post("/api/v1/analysis/jobs", files=files)
    assert response.status_code == 400
    assert "not a readable or valid video" in response.json()["detail"]

@pytest.mark.asyncio
async def test_job_lifecycle_end_to_end(client: AsyncClient, synthetic_video: Path):
    # 1. Submit valid synthetic video
    with synthetic_video.open("rb") as f:
        files = {"video": ("synthetic.mp4", f, "video/mp4")}
        data = {"save_to_history": "false"}
        response = await client.post("/api/v1/analysis/jobs", files=files, data=data)

    assert response.status_code == 201
    res_data = response.json()
    job_id = res_data["job_id"]
    assert res_data["status"] == "queued"

    # 2. Poll job status until completed
    completed = False
    for _ in range(60):  # max 30s
        await asyncio.sleep(0.5)
        status_resp = await client.get(f"/api/v1/analysis/jobs/{job_id}")
        assert status_resp.status_code == 200
        status_data = status_resp.json()
        if status_data["status"] == "completed":
            completed = True
            break
        elif status_data["status"] == "failed":
            pytest.fail(f"Job failed: {status_data.get('error')}")

    assert completed, "Job did not complete within timeout"

    # Verify summary
    summary = status_data["summary"]
    assert summary is not None
    assert summary["total_frames"] == 10
    assert summary["processed_frames"] == 10
    assert summary["duration_seconds"] > 0

    # 3. Retrieve results
    results_resp = await client.get(f"/api/v1/analysis/jobs/{job_id}/results?limit=5&offset=0")
    assert results_resp.status_code == 200
    results_data = results_resp.json()
    assert results_data["job_id"] == job_id
    assert results_data["total_frames"] == 10
    assert len(results_data["frames"]) == 5
    assert results_data["frames"][0]["frame_id"] == 1
    assert "boxes" in results_data["frames"][0]
    assert "tracks" in results_data["frames"][0]

    # 4. Download artifact
    artifact_resp = await client.get(f"/api/v1/analysis/jobs/{job_id}/artifact")
    assert artifact_resp.status_code == 200
    assert artifact_resp.headers["content-type"] == "application/gzip"

@pytest.mark.asyncio
async def test_job_cancellation(client: AsyncClient, synthetic_video: Path):
    with synthetic_video.open("rb") as f:
        files = {"video": ("cancel_test.mp4", f, "video/mp4")}
        response = await client.post("/api/v1/analysis/jobs", files=files)

    job_id = response.json()["job_id"]

    # Cancel immediately
    del_resp = await client.delete(f"/api/v1/analysis/jobs/{job_id}")
    assert del_resp.status_code == 200

    # Verify status is cancelled
    status_resp = await client.get(f"/api/v1/analysis/jobs/{job_id}")
    assert status_resp.status_code == 200
    assert status_resp.json()["status"] == "cancelled"

@pytest.mark.asyncio
async def test_invalid_detection_profile(client: AsyncClient, synthetic_video: Path):
    with synthetic_video.open("rb") as f:
        files = {"video": ("invalid_profile.mp4", f, "video/mp4")}
        data = {"detection_profile": "ultra_hd_custom"}
        response = await client.post("/api/v1/analysis/jobs", files=files, data=data)

    assert response.status_code == 400
    assert "Invalid detection profile" in response.json()["detail"]

@pytest.mark.asyncio
async def test_detection_profiles_and_job_isolation(client: AsyncClient, synthetic_video: Path):
    # 1. Submit High Recall job
    with synthetic_video.open("rb") as f:
        files = {"video": ("profile_hr.mp4", f, "video/mp4")}
        data = {"detection_profile": "high_recall"}
        resp_hr = await client.post("/api/v1/analysis/jobs", files=files, data=data)

    assert resp_hr.status_code == 201
    hr_data = resp_hr.json()
    assert hr_data["detection_profile"] == "high_recall"
    assert hr_data["confidence_threshold"] == 0.15
    assert hr_data["iou_threshold"] == 0.45

    # 2. Submit Balanced job
    with synthetic_video.open("rb") as f:
        files = {"video": ("profile_bal.mp4", f, "video/mp4")}
        data = {"detection_profile": "balanced"}
        resp_bal = await client.post("/api/v1/analysis/jobs", files=files, data=data)

    assert resp_bal.status_code == 201
    bal_data = resp_bal.json()
    assert bal_data["detection_profile"] == "balanced"
    assert bal_data["confidence_threshold"] == 0.20
    assert bal_data["iou_threshold"] == 0.45

    # 3. Check detail endpoint for both jobs
    detail_hr = await client.get(f"/api/v1/analysis/jobs/{hr_data['job_id']}")
    assert detail_hr.status_code == 200
    assert detail_hr.json()["detection_profile"] == "high_recall"
    assert detail_hr.json()["confidence_threshold"] == 0.15

    detail_bal = await client.get(f"/api/v1/analysis/jobs/{bal_data['job_id']}")
    assert detail_bal.status_code == 200
    assert detail_bal.json()["detection_profile"] == "balanced"
    assert detail_bal.json()["confidence_threshold"] == 0.20

@pytest.mark.asyncio
async def test_invalid_processing_speed(client: AsyncClient, synthetic_video: Path):
    with synthetic_video.open("rb") as f:
        files = {"video": ("invalid_speed.mp4", f, "video/mp4")}
        data = {"processing_speed": "ultra_turbo"}
        response = await client.post("/api/v1/analysis/jobs", files=files, data=data)

    assert response.status_code == 400
    assert "Invalid processing speed" in response.json()["detail"]

@pytest.mark.asyncio
async def test_processing_speed_fast_lifecycle(client: AsyncClient, synthetic_video: Path):
    # 1. Submit Fast Processing job (frame_stride = 2)
    with synthetic_video.open("rb") as f:
        files = {"video": ("fast_speed.mp4", f, "video/mp4")}
        data = {"processing_speed": "fast", "detection_profile": "balanced"}
        response = await client.post("/api/v1/analysis/jobs", files=files, data=data)

    assert response.status_code == 201
    res_data = response.json()
    assert res_data["processing_speed"] == "fast"
    assert res_data["frame_stride"] == 2
    job_id = res_data["job_id"]

    # 2. Wait for completion
    completed = False
    for _ in range(60):
        await asyncio.sleep(0.5)
        status_resp = await client.get(f"/api/v1/analysis/jobs/{job_id}")
        assert status_resp.status_code == 200
        status_data = status_resp.json()
        if status_data["status"] == "completed":
            completed = True
            break
        elif status_data["status"] == "failed":
            pytest.fail(f"Job failed: {status_data.get('error')}")

    assert completed, "Fast mode job did not complete within timeout"

    # Verify summary: for a 10 frame video with stride 2, 5 frames are processed (1, 3, 5, 7, 9)
    summary = status_data["summary"]
    assert summary is not None
    assert summary["total_frames"] == 10
    assert summary["processed_frames"] == 5
    assert summary["processing_speed"] == "fast"
    assert summary["frame_stride"] == 2

    # Check detail response fields
    assert status_data["processing_speed"] == "fast"
    assert status_data["frame_stride"] == 2

    # Verify that intermediate frames are properly interpolated and returned in results
    res_resp = await client.get(f"/api/v1/analysis/jobs/{job_id}/results?limit=10&offset=0")
    assert res_resp.status_code == 200
    res_data = res_resp.json()
    assert res_data["total_frames"] == 10
    assert len(res_data["frames"]) == 10

    # Frame 1 is sampled -> fresh detection
    frame_1 = res_data["frames"][0]
    assert frame_1["frame_id"] == 1
    for trk in frame_1["tracks"]:
        assert trk["observation_type"] in ("detection", "predicted")

    # Frame 2 is intermediate -> 0 fresh YOLO detections
    frame_2 = res_data["frames"][1]
    assert frame_2["frame_id"] == 2
    assert frame_2["detection_count"] == 0
    assert len(frame_2["boxes"]) == 0
    for trk in frame_2["tracks"]:
        assert trk["observation_type"] in ("interpolated", "predicted")

