from fastapi import APIRouter
from app.models.schemas import HealthResponse
from app.services.job_manager import job_manager
from app.config import settings

router = APIRouter()

@router.get("/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    detector = job_manager.detector
    model_ready = detector.is_ready if detector else False
    active_provider = detector.active_provider if detector else "Unknown"
    available_providers = detector.available_providers if detector else []

    return HealthResponse(
        status="healthy",
        service="visionguard-backend",
        version="1.0.0",
        model_ready=model_ready,
        model_path=str(settings.MODEL_PATH),
        execution_provider=active_provider,
        available_providers=available_providers
    )
