import shutil
import uuid
from pathlib import Path
from typing import Optional
import cv2
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query, status
from fastapi.responses import FileResponse

from app.models.schemas import (
    JobCreateResponse,
    JobDetailResponse,
    JobResultsResponse,
    JobStatus
)
from app.services.job_manager import job_manager
from app.storage.artifact import artifact_manager
from app.config import settings
from app.core.logging import logger

router = APIRouter()

ALLOWED_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}

@router.post("/jobs", response_model=JobCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_analysis_job(
    video: Optional[UploadFile] = File(None),
    video_url: Optional[str] = Form(None),
    save_to_history: bool = Form(False),
    video_id: Optional[str] = Form(None),
    detection_profile: str = Form("balanced"),
    processing_speed: str = Form("full"),
    calibration: Optional[str] = Form(None)
) -> JobCreateResponse:
    # 0. Validate detection profile and processing speed
    profile = detection_profile.strip().lower()
    if profile not in ("balanced", "high_recall"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid detection profile '{detection_profile}'. Allowed profiles: 'balanced', 'high_recall'"
        )

    speed = processing_speed.strip().lower()
    if speed not in ("full", "fast"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid processing speed '{processing_speed}'. Allowed speeds: 'full', 'fast'"
        )

    if not video and not video_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either a video file or video_url must be provided"
        )

    temp_upload_id = uuid.uuid4().hex

    if video:
        filename = video.filename or "video.mp4"
        suffix = Path(filename).suffix.lower() or ".mp4"
        if suffix not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported video format '{suffix}'. Allowed formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            )

        temp_path = settings.UPLOAD_DIR / f"{temp_upload_id}{suffix}"
        total_bytes = 0
        try:
            with temp_path.open("wb") as buffer:
                while chunk := await video.read(1024 * 1024):  # 1MB chunks
                    total_bytes += len(chunk)
                    if total_bytes > settings.MAX_UPLOAD_SIZE_BYTES:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=f"Video exceeds maximum allowed size ({settings.MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB)"
                        )
                    buffer.write(chunk)
        except HTTPException:
            if temp_path.exists():
                temp_path.unlink()
            raise
        except Exception as e:
            if temp_path.exists():
                temp_path.unlink()
            logger.error(f"Failed to save uploaded video: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to process video upload: {str(e)}"
            )
    else:
        import urllib.request
        clean_url = (video_url or "").strip()
        local_candidates = [
            Path(clean_url),
            Path(clean_url.lstrip("/")),
            settings.BASE_DIR / clean_url.lstrip("/"),
            settings.BASE_DIR.parent / clean_url.lstrip("/"),
            settings.BASE_DIR.parent / "apps" / "web" / "public" / clean_url.lstrip("/"),
            settings.BASE_DIR.parent / "assets" / clean_url.lstrip("/")
        ]
        found_local = None
        for candidate in local_candidates:
            if candidate.is_file():
                found_local = candidate
                break

        if found_local:
            suffix = found_local.suffix.lower() or ".mp4"
            temp_path = settings.UPLOAD_DIR / f"{temp_upload_id}{suffix}"
            shutil.copyfile(str(found_local), str(temp_path))
        elif clean_url.startswith("http://") or clean_url.startswith("https://"):
            suffix = Path(clean_url.split("?")[0]).suffix.lower() or ".mp4"
            if suffix not in ALLOWED_EXTENSIONS:
                suffix = ".mp4"
            temp_path = settings.UPLOAD_DIR / f"{temp_upload_id}{suffix}"
            try:
                urllib.request.urlretrieve(clean_url, str(temp_path))
            except Exception as e:
                logger.error(f"Failed to download video from URL: {e}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to retrieve video from URL: {str(e)}"
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Could not locate or resolve video source: '{clean_url}'"
            )

    # 3. Validate video readability with OpenCV
    cap = cv2.VideoCapture(str(temp_path))
    is_valid = cap.isOpened()
    if is_valid:
        w = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
        h = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
        if w <= 0 or h <= 0:
            is_valid = False
    cap.release()

    if not is_valid:
        if temp_path.exists():
            temp_path.unlink()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is not a readable or valid video file."
        )

    # 4. Parse calibration & compute homography matrix if available
    import json
    from app.pipeline.speed import compute_homography_from_calibration

    homography_matrix = None
    calibration_data = None
    if calibration:
        try:
            parsed_cal = json.loads(calibration) if isinstance(calibration, str) else calibration
            if isinstance(parsed_cal, dict):
                h_mat = compute_homography_from_calibration(parsed_cal)
                if h_mat:
                    homography_matrix = h_mat
                    calibration_data = parsed_cal
                    logger.info(f"Calibration homography computed successfully for job ({len(h_mat)} coefficients)")
                else:
                    logger.warning("Calibration data provided but homography computation failed; proceeding uncalibrated")
        except Exception as e:
            logger.warning(f"Failed to parse calibration payload: {e}")

    # 5. Enqueue job
    record = job_manager.create_job(
        video_path=temp_path,
        save_to_history=save_to_history,
        video_id=video_id,
        detection_profile=profile,
        processing_speed=speed,
        homography_matrix=homography_matrix,
        calibration_data=calibration_data
    )

    return JobCreateResponse(
        job_id=record.job_id,
        status=record.status,
        message="Video analysis job successfully created and queued.",
        created_at=record.created_at,
        detection_profile=record.detection_profile,
        confidence_threshold=record.confidence_threshold,
        iou_threshold=record.iou_threshold,
        processing_speed=record.processing_speed,
        frame_stride=record.frame_stride,
        is_calibrated=bool(homography_matrix)
    )

@router.get("/jobs/{job_id}", response_model=JobDetailResponse)
async def get_job_status(job_id: str) -> JobDetailResponse:
    record = job_manager.get_job(job_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job '{job_id}' not found")
    return record.to_detail_response()

@router.get("/jobs/{job_id}/results", response_model=JobResultsResponse)
async def get_job_results(
    job_id: str,
    start_time: Optional[float] = Query(None, ge=0.0),
    end_time: Optional[float] = Query(None, ge=0.0),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0)
) -> JobResultsResponse:
    record = job_manager.get_job(job_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job '{job_id}' not found")

    if record.status != JobStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Job '{job_id}' is not yet completed (current status: {record.status.value})"
        )

    slice_data = artifact_manager.get_results_slice(
        job_id=job_id,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
        offset=offset
    )

    if not slice_data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Results artifact for job '{job_id}' not found")

    return JobResultsResponse(**slice_data)

@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str) -> dict:
    record = job_manager.get_job(job_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job '{job_id}' not found")

    cancelled = job_manager.cancel_job(job_id)
    return {
        "job_id": job_id,
        "status": JobStatus.CANCELLED.value if cancelled else record.status.value,
        "message": f"Job '{job_id}' was cancelled."
    }

@router.get("/jobs/{job_id}/artifact")
async def download_job_artifact(job_id: str) -> FileResponse:
    record = job_manager.get_job(job_id)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Job '{job_id}' not found")

    if record.status != JobStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Job '{job_id}' is not yet completed (current status: {record.status.value})"
        )

    artifact_path = artifact_manager.get_artifact_path(job_id)
    if not artifact_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact file not found")

    return FileResponse(
        path=artifact_path,
        media_type="application/gzip",
        filename=f"visionguard_analysis_{job_id}.json.gz"
    )
