from enum import Enum
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field

class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class DetectionProfile(str, Enum):
    BALANCED = "balanced"
    HIGH_RECALL = "high_recall"

class ProcessingSpeed(str, Enum):
    FULL = "full"
    FAST = "fast"

PROFILE_THRESHOLDS: Dict[str, Dict[str, float]] = {
    DetectionProfile.BALANCED.value: {
        "confidence_threshold": 0.20,
        "iou_threshold": 0.45
    },
    DetectionProfile.HIGH_RECALL.value: {
        "confidence_threshold": 0.15,
        "iou_threshold": 0.45
    }
}

class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    model_ready: bool
    model_path: str
    execution_provider: str
    available_providers: List[str]

class JobProgress(BaseModel):
    percentage: float = 0.0
    current_frame: int = 0
    total_frames: int = 0
    fps: float = 0.0
    processing_fps: float = 0.0
    elapsed_seconds: float = 0.0
    video_duration: float = 0.0
    stage: str = "processing"

class JobSummary(BaseModel):
    total_frames: int = 0
    processed_frames: int = 0
    duration_seconds: float = 0.0
    unique_vehicles: int = 0
    vehicle_counts_by_class: Dict[str, int] = Field(default_factory=dict)
    max_vehicles_in_frame: int = 0
    average_speed_kmh: Optional[float] = None
    speed_violations_count: int = 0
    detection_profile: str = "balanced"
    confidence_threshold: float = 0.20
    iou_threshold: float = 0.45
    processing_speed: str = "full"
    frame_stride: int = 1
    is_calibrated: bool = False
    calibration: Optional[Dict[str, Any]] = None

class JobCreateResponse(BaseModel):
    job_id: str
    status: JobStatus
    message: str
    created_at: str
    detection_profile: str = "balanced"
    confidence_threshold: float = 0.20
    iou_threshold: float = 0.45
    processing_speed: str = "full"
    frame_stride: int = 1
    is_calibrated: bool = False

class JobDetailResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: Optional[JobProgress] = None
    summary: Optional[JobSummary] = None
    error: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None
    save_to_history: bool = False
    video_id: Optional[str] = None
    detection_profile: str = "balanced"
    confidence_threshold: float = 0.20
    iou_threshold: float = 0.45
    processing_speed: str = "full"
    frame_stride: int = 1
    is_calibrated: bool = False
    calibration: Optional[Dict[str, Any]] = None

class BoundingBox(BaseModel):
    x: float  # Center X in original video coordinates
    y: float  # Center Y in original video coordinates
    w: float  # Width in original video coordinates
    h: float  # Height in original video coordinates
    prob: float
    class_id: int
    class_name: str

class TrackedObject(BaseModel):
    track_id: int
    x: float  # Center X in original video coordinates
    y: float  # Center Y in original video coordinates
    w: float  # Width in original video coordinates
    h: float  # Height in original video coordinates
    dx: Optional[float] = None
    dy: Optional[float] = None
    prob: float
    class_id: int
    class_name: str
    speed: Optional[float] = None  # Non-negative scalar speed in km/h if calibrated, else None
    velocity: Optional[float] = None  # Signed velocity in km/h
    is_overspeed: bool = False
    state: str = "Confirmed"
    observation_type: str = "detection"
    prediction_confidence: Optional[float] = None

class FrameResult(BaseModel):
    frame_id: int
    media_time: float
    source_width: int
    source_height: int
    boxes: List[BoundingBox] = Field(default_factory=list)
    tracks: List[TrackedObject] = Field(default_factory=list)
    detection_count: int = 0

class JobResultsResponse(BaseModel):
    job_id: str
    version: str = "1.0"
    total_frames: int
    returned_frames: int
    offset: int
    limit: int
    frames: List[FrameResult]
