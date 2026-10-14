import asyncio
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List
import uuid

from app.models.schemas import JobStatus, JobProgress, JobSummary, JobDetailResponse
from app.pipeline.detector import YOLODetector
from app.pipeline.processor import VideoProcessor
from app.storage.artifact import artifact_manager
from app.config import settings
from app.core.logging import logger

class JobRecord:
    def __init__(
        self,
        job_id: str,
        video_path: Path,
        save_to_history: bool,
        video_id: Optional[str] = None,
        detection_profile: str = "balanced",
        conf_threshold: Optional[float] = None,
        iou_threshold: Optional[float] = None,
        processing_speed: str = "full",
        frame_stride: int = 1,
        homography_matrix: Optional[List[float]] = None,
        calibration_data: Optional[Dict[str, Any]] = None
    ):
        self.job_id = job_id
        self.video_path = video_path
        self.save_to_history = save_to_history
        self.video_id = video_id
        self.detection_profile = detection_profile
        self.confidence_threshold = conf_threshold if conf_threshold is not None else (0.15 if detection_profile == "high_recall" else 0.20)
        self.iou_threshold = iou_threshold if iou_threshold is not None else 0.45
        self.processing_speed = processing_speed
        self.frame_stride = frame_stride
        self.homography_matrix = homography_matrix
        self.calibration_data = calibration_data
        self.status = JobStatus.QUEUED
        self.progress = JobProgress()
        self.summary: Optional[JobSummary] = None
        self.error: Optional[str] = None
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.completed_at: Optional[str] = None
        self.cancelled = False

    def to_detail_response(self) -> JobDetailResponse:
        is_cal = bool(self.homography_matrix and len(self.homography_matrix) == 9)
        if self.summary and hasattr(self.summary, 'is_calibrated'):
            is_cal = self.summary.is_calibrated
        return JobDetailResponse(
            job_id=self.job_id,
            status=self.status,
            progress=self.progress,
            summary=self.summary,
            error=self.error,
            created_at=self.created_at,
            completed_at=self.completed_at,
            save_to_history=self.save_to_history,
            video_id=self.video_id,
            detection_profile=self.detection_profile,
            confidence_threshold=self.confidence_threshold,
            iou_threshold=self.iou_threshold,
            processing_speed=self.processing_speed,
            frame_stride=self.frame_stride,
            is_calibrated=is_cal,
            calibration=self.calibration_data
        )

class JobManager:
    def __init__(self):
        self.jobs: Dict[str, JobRecord] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.worker_task: Optional[asyncio.Task] = None
        self.detector: Optional[YOLODetector] = None
        self.processor: Optional[VideoProcessor] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def initialize(self) -> None:
        if not self.detector:
            self.detector = YOLODetector()
            self.processor = VideoProcessor(self.detector)
        self.ensure_worker_running()

    def ensure_worker_running(self) -> None:
        try:
            loop = asyncio.get_running_loop()
            if self._loop != loop:
                if self.worker_task and not self.worker_task.done():
                    self.worker_task.cancel()
                self._loop = loop
                self.queue = asyncio.Queue()
                self.worker_task = loop.create_task(self._worker_loop())
                logger.info("JobManager background worker started on active event loop")
            elif not self.worker_task or self.worker_task.done():
                self.worker_task = loop.create_task(self._worker_loop())
                logger.info("JobManager background worker started")
        except RuntimeError:
            # No running event loop yet (e.g. during sync startup); worker will start when loop is active
            pass

    async def shutdown(self) -> None:
        if self.worker_task and not self.worker_task.done():
            self.worker_task.cancel()
            try:
                await self.worker_task
            except (asyncio.CancelledError, Exception):
                pass
            logger.info("JobManager background worker stopped")

    def create_job(
        self,
        video_path: Path,
        save_to_history: bool = False,
        video_id: Optional[str] = None,
        detection_profile: str = "balanced",
        processing_speed: str = "full",
        homography_matrix: Optional[List[float]] = None,
        calibration_data: Optional[Dict[str, Any]] = None
    ) -> JobRecord:
        self.initialize()
        profile_key = detection_profile.lower()
        if profile_key not in ("balanced", "high_recall"):
            profile_key = "balanced"

        speed_key = processing_speed.strip().lower()
        if speed_key not in ("full", "fast"):
            speed_key = "full"

        stride = 2 if speed_key == "fast" else 1

        conf_th = 0.15 if profile_key == "high_recall" else 0.20
        iou_th = 0.45

        job_id = uuid.uuid4().hex
        record = JobRecord(
            job_id=job_id,
            video_path=video_path,
            save_to_history=save_to_history,
            video_id=video_id,
            detection_profile=profile_key,
            conf_threshold=conf_th,
            iou_threshold=iou_th,
            processing_speed=speed_key,
            frame_stride=stride,
            homography_matrix=homography_matrix,
            calibration_data=calibration_data
        )
        self.jobs[job_id] = record
        self.queue.put_nowait(job_id)
        cal_str = "calibrated" if homography_matrix else "uncalibrated"
        logger.info(f"Job created: {job_id} for video '{video_path.name}' ({cal_str}, profile={profile_key}, speed={speed_key}, stride={stride}, conf={conf_th}, iou={iou_th})")
        return record

    def get_job(self, job_id: str) -> Optional[JobRecord]:
        return self.jobs.get(job_id)

    def cancel_job(self, job_id: str) -> bool:
        record = self.jobs.get(job_id)
        if not record:
            return False

        if record.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
            if not record.save_to_history and record.video_path.exists():
                try:
                    record.video_path.unlink()
                except Exception:
                    pass
            artifact_manager.cleanup_artifacts(job_id)
            return True

        record.cancelled = True
        record.status = JobStatus.CANCELLED
        record.completed_at = datetime.now(timezone.utc).isoformat()
        logger.info(f"Cancellation requested for job {job_id}")

        # Clean up temporary video if local only
        if not record.save_to_history and record.video_path.exists():
            try:
                record.video_path.unlink()
            except Exception:
                pass
        artifact_manager.cleanup_artifacts(job_id)

        return True

    async def _worker_loop(self) -> None:
        while True:
            try:
                job_id = await self.queue.get()
                record = self.jobs.get(job_id)
                if not record or record.cancelled:
                    self.queue.task_done()
                    continue

                await self._process_job_async(record)
                self.queue.task_done()
            except (asyncio.CancelledError, RuntimeError):
                break
            except Exception as e:
                logger.error(f"Unexpected error in worker loop: {e}", exc_info=True)
                break

    async def _process_job_async(self, record: JobRecord) -> None:
        record.status = JobStatus.RUNNING
        logger.info(f"Processing started for job {record.job_id}")

        loop = asyncio.get_running_loop()

        def is_cancelled() -> bool:
            return record.cancelled

        def progress_callback(cur_frame: int, total_frames: int, elapsed: float, proc_fps: float) -> None:
            pct = round((cur_frame / total_frames) * 95.0, 1) if total_frames > 0 else 0.0
            record.progress.current_frame = cur_frame
            record.progress.total_frames = total_frames
            record.progress.percentage = min(95.0, max(0.0, pct))
            record.progress.elapsed_seconds = round(elapsed, 1)
            record.progress.processing_fps = round(proc_fps, 1)
            record.progress.stage = "processing"

        try:
            # Run CPU/Inference bound OpenCV decoding and YOLO detection in a thread pool executor
            result = await loop.run_in_executor(
                None,
                self.processor.process_video,
                record.video_path,
                record.job_id,
                is_cancelled,
                progress_callback,
                record.homography_matrix,
                record.frame_stride,
                record.confidence_threshold,
                record.iou_threshold,
                record.detection_profile,
                record.processing_speed
            )

            # Transition to explicit finalizing stage
            record.progress.stage = "finalizing"
            record.progress.percentage = 96.0
            logger.info(f"Finalizing results and writing artifact for job {record.job_id}...")

            if record.calibration_data:
                result["summary"]["calibration"] = record.calibration_data

            # Persist compressed analysis artifact in thread pool to prevent blocking async event loop
            await loop.run_in_executor(
                None,
                artifact_manager.write_artifact,
                record.job_id,
                result["video_metadata"],
                result["summary"],
                result["frames"]
            )

            # Update record status & summary
            record.summary = JobSummary(**result["summary"])
            record.progress.percentage = 100.0
            record.progress.stage = "completed"
            record.status = JobStatus.COMPLETED
            record.completed_at = datetime.now(timezone.utc).isoformat()
            logger.info(f"Processing completed for job {record.job_id} in {record.progress.elapsed_seconds}s ({record.summary.unique_vehicles} unique vehicles)")

            # Clean up temporary uploaded video if user did not choose to save to History
            if not record.save_to_history and record.video_path.exists():
                try:
                    record.video_path.unlink()
                    logger.info(f"Local temporary video unlinked for job {record.job_id}")
                except Exception as e:
                    logger.warning(f"Failed to unlink temporary video: {e}")

        except InterruptedError:
            record.status = JobStatus.CANCELLED
            record.progress.stage = "cancelled"
            record.completed_at = datetime.now(timezone.utc).isoformat()
            logger.info(f"Job {record.job_id} was successfully cancelled")
        except Exception as e:
            record.status = JobStatus.FAILED
            record.error = str(e)
            record.progress.stage = "failed"
            record.completed_at = datetime.now(timezone.utc).isoformat()
            logger.error(f"Job {record.job_id} failed: {e}", exc_info=True)
            # Cleanup temporary video on failure if local-only
            if not record.save_to_history and record.video_path.exists():
                try:
                    record.video_path.unlink()
                except Exception:
                    pass

job_manager = JobManager()
