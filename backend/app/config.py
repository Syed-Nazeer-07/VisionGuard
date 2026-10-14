import os
from pathlib import Path
from typing import List
from pydantic import BaseModel
from dotenv import load_dotenv

# Load .env if present
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent

class Settings(BaseModel):
    BASE_DIR: Path = BASE_DIR
    PROJECT_ROOT: Path = PROJECT_ROOT
    HOST: str = os.getenv("VISIONGUARD_HOST", "127.0.0.1")
    PORT: int = int(os.getenv("VISIONGUARD_PORT", "8000"))
    
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    
    # Path to the YOLO11n ONNX model (reusing the existing model in apps/web/public/models/yolo11n.onnx)
    MODEL_PATH: Path = Path(os.getenv("VISIONGUARD_MODEL_PATH", str(PROJECT_ROOT / "apps" / "web" / "public" / "models" / "yolo11n.onnx"))).resolve()
    
    UPLOAD_DIR: Path = Path(os.getenv("VISIONGUARD_UPLOAD_DIR", str(BASE_DIR / "uploads"))).resolve()
    ARTIFACT_DIR: Path = Path(os.getenv("VISIONGUARD_ARTIFACT_DIR", str(BASE_DIR / "artifacts"))).resolve()
    
    # 1 GB upload limit by default
    MAX_UPLOAD_SIZE_BYTES: int = int(os.getenv("VISIONGUARD_MAX_UPLOAD_BYTES", str(1024 * 1024 * 1024)))
    
    # Inference parameters
    CONFIDENCE_THRESHOLD: float = float(os.getenv("VISIONGUARD_CONF_THRESHOLD", "0.20"))
    IOU_THRESHOLD: float = float(os.getenv("VISIONGUARD_IOU_THRESHOLD", "0.45"))
    
    # Execution provider override (None = auto-detect)
    PREFERRED_EXECUTION_PROVIDER: str | None = os.getenv("VISIONGUARD_EXECUTION_PROVIDER", None)
    
    # Performance and concurrency settings
    CPU_INTRA_OP_THREADS: int = int(os.getenv("VISIONGUARD_INTRA_OP_THREADS", "8"))
    CPU_INTER_OP_THREADS: int = int(os.getenv("VISIONGUARD_INTER_OP_THREADS", "1"))
    OPENCV_NUM_THREADS: int = int(os.getenv("VISIONGUARD_OPENCV_THREADS", "2"))
    
    # Maximum concurrent background jobs (1 = strictly safe local concurrency)
    MAX_CONCURRENT_JOBS: int = int(os.getenv("VISIONGUARD_MAX_CONCURRENT_JOBS", "1"))
    
    # Temporary artifact retention period in hours
    LOCAL_RETENTION_HOURS: int = int(os.getenv("VISIONGUARD_RETENTION_HOURS", "24"))

settings = Settings()

# Ensure runtime directories exist
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
