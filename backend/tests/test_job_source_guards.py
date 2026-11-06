"""Integration-level job API guards: unsafe source rejected before OpenCV or job creation."""
import asyncio

import pytest
from fastapi import HTTPException

from app.api.endpoints.jobs import create_analysis_job


def submit_source(video_url: str):
    return asyncio.run(create_analysis_job(
        video=None, video_url=video_url, save_to_history=False,
        video_id=None, detection_profile="balanced", processing_speed="full",
        calibration=None
    ))


@pytest.mark.parametrize("source", [
    "http://127.0.0.1:8000/health",
    "http://169.254.169.254/latest/meta-data/",
    "https://example.com/video.mp4",
    "file:///etc/passwd",
    "/etc/passwd",
    "../private.mp4",
])
def test_job_rejects_untrusted_urls_and_arbitrary_file_paths(source):
    with pytest.raises(HTTPException) as error:
        submit_source(source)
    assert error.value.status_code == 400
    assert "Traceback" not in str(error.value.detail)
    assert "127.0.0.1:8000" not in str(error.value.detail)


def test_remote_host_must_be_allowed_before_any_fetch(monkeypatch):
    from app.config import settings
    import app.security.video_sources as sources

    monkeypatch.setattr(settings, "REMOTE_VIDEO_ALLOWED_HOSTS", [])
    called = False

    def no_request(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("Network fetch must not be performed")

    monkeypatch.setattr(sources.urllib.request, "build_opener", no_request)
    with pytest.raises(HTTPException) as error:
        submit_source("https://cloud-storage.test/signed-video.mp4?access_token=private")
    assert error.value.status_code == 400
    assert "access_token" not in str(error.value.detail)
    assert not called


def test_url_with_credential_fragment_does_not_enter_processor(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "REMOTE_VIDEO_ALLOWED_HOSTS", ["cloud-storage.test"])
    with pytest.raises(HTTPException) as error:
        submit_source("https://user:pass@cloud-storage.test/video.mp4")
    assert error.value.status_code == 400
    assert "user:pass" not in str(error.value.detail)
