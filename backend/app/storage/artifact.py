import gzip
import json
from pathlib import Path
from typing import Dict, List, Any, Optional
from app.config import settings
from app.core.logging import logger

class ArtifactManager:
    def __init__(self, artifact_dir: Path | None = None):
        self.artifact_dir = artifact_dir or settings.ARTIFACT_DIR
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        self._cache: Dict[str, Dict[str, Any]] = {}

    def get_job_artifact_dir(self, job_id: str) -> Path:
        job_dir = self.artifact_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        return job_dir

    def get_artifact_path(self, job_id: str) -> Path:
        return self.get_job_artifact_dir(job_id) / "results.json.gz"

    def write_artifact(
        self,
        job_id: str,
        video_metadata: Dict[str, Any],
        summary: Dict[str, Any],
        frames: List[Dict[str, Any]]
    ) -> Path:
        artifact_path = self.get_artifact_path(job_id)
        payload = {
            "version": "1.0",
            "job_id": job_id,
            "detection_profile": summary.get("detection_profile", "balanced"),
            "confidence_threshold": summary.get("confidence_threshold", 0.20),
            "iou_threshold": summary.get("iou_threshold", 0.45),
            "processing_speed": summary.get("processing_speed", "full"),
            "frame_stride": summary.get("frame_stride", 1),
            "video_metadata": video_metadata,
            "summary": summary,
            "total_frames": len(frames),
            "frames": frames
        }

        # Atomic write to temporary file first, then rename to destination
        temp_path = artifact_path.with_suffix('.tmp')
        try:
            with gzip.open(temp_path, "wt", encoding="utf-8", compresslevel=3) as f:
                json.dump(payload, f, separators=(',', ':'))
            temp_path.replace(artifact_path)
        except Exception:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except Exception:
                    pass
            raise

        # Cache payload in memory to eliminate repeated disk unzips on subsequent queries
        self._cache[job_id] = payload
        if len(self._cache) > 5:
            oldest_key = next(iter(self._cache))
            del self._cache[oldest_key]

        logger.info(f"Saved compressed analysis artifact for job {job_id} ({artifact_path.stat().st_size} bytes)")
        return artifact_path

    def read_artifact(self, job_id: str) -> Optional[Dict[str, Any]]:
        if job_id in self._cache:
            return self._cache[job_id]

        artifact_path = self.get_artifact_path(job_id)
        if not artifact_path.exists():
            return None

        try:
            with gzip.open(artifact_path, "rt", encoding="utf-8") as f:
                data = json.load(f)
            self._cache[job_id] = data
            if len(self._cache) > 5:
                oldest_key = next(iter(self._cache))
                del self._cache[oldest_key]
            return data
        except Exception as e:
            logger.error(f"Failed to read artifact for job {job_id}: {e}")
            return None

    def get_results_slice(
        self,
        job_id: str,
        start_time: Optional[float] = None,
        end_time: Optional[float] = None,
        limit: int = 100,
        offset: int = 0
    ) -> Optional[Dict[str, Any]]:
        data = self.read_artifact(job_id)
        if not data:
            return None

        all_frames: List[Dict[str, Any]] = data.get("frames", [])
        
        # Filter by media_time range if requested
        if start_time is not None or end_time is not None:
            min_t = start_time if start_time is not None else 0.0
            max_t = end_time if end_time is not None else float("inf")
            filtered = [f for f in all_frames if min_t <= f.get("media_time", 0.0) <= max_t]
        else:
            filtered = all_frames

        total_matching = len(filtered)
        paginated_frames = filtered[offset: offset + limit]

        return {
            "job_id": job_id,
            "version": data.get("version", "1.0"),
            "total_frames": len(all_frames),
            "returned_frames": len(paginated_frames),
            "offset": offset,
            "limit": limit,
            "frames": paginated_frames
        }

    def cleanup_artifacts(self, job_id: str) -> None:
        self._cache.pop(job_id, None)
        job_dir = self.artifact_dir / job_id
        if job_dir.exists():
            for p in job_dir.iterdir():
                try:
                    p.unlink()
                except Exception:
                    pass
            try:
                job_dir.rmdir()
                logger.info(f"Cleaned up artifacts for job {job_id}")
            except Exception:
                pass

artifact_manager = ArtifactManager()
