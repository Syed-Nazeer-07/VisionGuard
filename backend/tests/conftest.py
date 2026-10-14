import tempfile
from pathlib import Path
from typing import Generator
import cv2
import numpy as np
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.services.job_manager import job_manager

@pytest_asyncio.fixture
async def client() -> AsyncClient:
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as ac:
            yield ac

@pytest.fixture
def synthetic_video() -> Generator[Path, None, None]:
    """
    Creates a tiny synthetic 10-frame video (640x480, 30fps) with a moving box.
    """
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tf:
        temp_path = Path(tf.name)

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(temp_path), fourcc, 30.0, (640, 480))

    for i in range(10):
        frame = np.full((480, 640, 3), 100, dtype=np.uint8)
        # Draw moving rectangle simulating a vehicle
        x1 = 100 + i * 10
        y1 = 150
        x2 = x1 + 80
        y2 = y1 + 60
        cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 255, 255), -1)
        out.write(frame)

    out.release()
    yield temp_path

    if temp_path.exists():
        try:
            temp_path.unlink()
        except Exception:
            pass

@pytest.fixture
def corrupt_video() -> Generator[Path, None, None]:
    """
    Creates a corrupt / invalid video file.
    """
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tf:
        tf.write(b"NOT_A_VALID_MP4_HEADER_CORRUPTED_DATA")
        temp_path = Path(tf.name)

    yield temp_path

    if temp_path.exists():
        try:
            temp_path.unlink()
        except Exception:
            pass
