"""Security checks for local-file and remote-video input boundaries."""
import socket
from pathlib import Path

import pytest

from app.security.video_sources import (
    VideoSourceError, local_video_path, trusted_https_video_url,
)


def test_trusted_root_allows_real_video_and_root_prefixed_relative_name(tmp_path):
    media = tmp_path / "uploads"
    media.mkdir()
    video = media / "road.mp4"
    video.write_bytes(b"not actually decoded in this pure path test")
    assert local_video_path(str(video), [media], max_bytes=1024) == video
    assert local_video_path("road.mp4", [media], max_bytes=1024) == video
    assert local_video_path("uploads/road.mp4", [media], max_bytes=1024) == video


def test_file_traversal_and_symlink_escape_are_denied(tmp_path):
    root = tmp_path / "uploads"
    root.mkdir()
    outside = tmp_path / "private.mp4"
    outside.write_bytes(b"private")
    (root / "escape.mp4").symlink_to(outside)
    for source in ["../private.mp4", str(outside), "escape.mp4"]:
        with pytest.raises(VideoSourceError, match="allowed local media"):
            local_video_path(source, [root], max_bytes=1000)


def test_local_video_extension_and_size_are_restricted(tmp_path):
    root = tmp_path / "assets"
    root.mkdir()
    (root / "text.txt").write_bytes(b"not a video")
    (root / "large.mp4").write_bytes(b"x" * 100)
    for source in ["text.txt", "large.mp4"]:
        with pytest.raises(VideoSourceError):
            local_video_path(source, [root], max_bytes=10)


@pytest.mark.parametrize("url", [
    "http://example.test/video.mp4",
    "https://user:password@example.test/video.mp4",
    "https://example.test:444/video.mp4",
    "https://example.test/video.mp4#fragment",
    "file:///etc/hosts",
    "https://evil.example.test/video.mp4",
])
def test_untrusted_remote_urls_are_rejected(url):
    with pytest.raises(VideoSourceError):
        trusted_https_video_url(
            url, ["example.test"], resolve_ips=lambda hostname: ["8.8.8.8"]
        )


@pytest.mark.parametrize("address", [
    "127.0.0.1", "10.0.0.8", "192.168.0.9", "169.254.169.254", "::1",
    "fc00::1", "0.0.0.0"
])
def test_private_and_metadata_ips_are_never_permitted(address):
    with pytest.raises(VideoSourceError, match="unsafe non-public address"):
        trusted_https_video_url(
            "https://storage.example.test/road.mp4",
            ["storage.example.test"],
            resolve_ips=lambda hostname: [address]
        )


def test_all_dns_records_must_be_public():
    with pytest.raises(VideoSourceError, match="unsafe non-public address"):
        trusted_https_video_url(
            "https://storage.example.test/road.mp4", ["storage.example.test"],
            resolve_ips=lambda hostname: ["8.8.8.8", "127.0.0.1"]
        )


def test_empty_allowlist_disables_remote_fetch_and_public_allowlisted_host_succeeds():
    url = "https://storage.example.test/video.mp4?signature=private"
    with pytest.raises(VideoSourceError, match="disabled"):
        trusted_https_video_url(url, [], resolve_ips=lambda hostname: ["8.8.8.8"])
    assert trusted_https_video_url(
        url, ["storage.example.test"],
        resolve_ips=lambda hostname: ["8.8.8.8"]
    ) == url


def test_malformed_dns_is_rejected_without_private_details():
    with pytest.raises(VideoSourceError, match="invalid"):
        trusted_https_video_url(
            "https://storage.example.test/road.mp4",
            ["storage.example.test"], resolve_ips=lambda hostname: ["not-an-ip"]
        )
