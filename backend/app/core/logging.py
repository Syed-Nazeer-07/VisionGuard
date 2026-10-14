import logging
import sys
from datetime import datetime, timezone

class StructuredFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.now(timezone.utc).isoformat()
        job_id = getattr(record, "job_id", None)
        job_tag = f" [job:{job_id}]" if job_id else ""
        return f"[{timestamp}] [{record.levelname}]{job_tag} {record.getMessage()}"

def setup_logger(name: str = "visionguard") -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    
    # Avoid duplicate handlers if already configured
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(StructuredFormatter())
        logger.addHandler(handler)
        
    return logger

logger = setup_logger()
