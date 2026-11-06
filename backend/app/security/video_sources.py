"""Conservative input boundaries for the unauthenticated LOOPBACK-ONLY AI backend.

Remote URLs are forbidden by default. Operators may explicitly allow exact
trusted HTTPS storage hosts using VISIONGUARD_ALLOWED_VIDEO_HOSTS. Do not use
this local backend as an internet-facing analysis service without separate
authentication, rate limits and network egress isolation.
"""
from __future__ import annotations

import ipaddress
import shutil
import socket
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Iterable


ALLOWED_VIDEO_EXTENSIONS = frozenset({".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"})


class VideoSourceError(ValueError):
    """Safe-to-show error (never contains credentials or full URLs)."""


def local_video_path(source: str, roots: Iterable[Path], *, max_bytes: int) -> Path:
    """Only open files from dedicated, explicitly configured media roots.

    .resolve(strict=True) rejects traversal and symlinks that escape a root.
    Relative paths are interpreted within each media root, not the process CWD.
    """
    if not source or "\x00" in source:
        raise VideoSourceError("Video path is missing or invalid")
    path = Path(source)
    for root in roots:
        trusted = Path(root).resolve()
        relative = path
        # Permit the usual assets/clip.mp4 and uploads/clip.mp4 notation.
        if not path.is_absolute() and path.parts and path.parts[0] == trusted.name:
            relative = Path(*path.parts[1:])
        try:
            candidate = (relative if path.is_absolute() else trusted / relative).resolve(strict=True)
            candidate.relative_to(trusted)
        except (OSError, ValueError):
            continue
        if not candidate.is_file() or candidate.suffix.lower() not in ALLOWED_VIDEO_EXTENSIONS:
            continue
        size = candidate.stat().st_size
        if not (0 < size <= max_bytes):
            raise VideoSourceError("Local video is empty or exceeds the configured size limit")
        return candidate
    raise VideoSourceError("Video is not inside an allowed local media directory")


def _resolved_ips(hostname: str) -> list[str]:
    try:
        return list({
            item[4][0] for item in socket.getaddrinfo(
                hostname, 443, type=socket.SOCK_STREAM
            )
        })
    except OSError as exc:
        raise VideoSourceError("Trusted video host could not be resolved") from exc


def trusted_https_video_url(
    raw: str, allowed_hosts: Iterable[str],
    *, resolve_ips: Callable[[str], Iterable[str]] = _resolved_ips
) -> str:
    """Reject SSRF primitives before any HTTP request.

    Exact hostname allowlisting + public-address checks + HTTPS TLS checking
    are defense in depth. Network-level egress restrictions remain advisable.
    """
    permitted = {h.strip().lower().rstrip(".") for h in allowed_hosts if h.strip()}
    if not permitted:
        raise VideoSourceError(
            "Remote video URLs are disabled. Configure VISIONGUARD_ALLOWED_VIDEO_HOSTS "
            "for exact trusted HTTPS storage hosts."
        )
    if not raw or len(raw) > 4096 or any(c in raw for c in "\r\n\x00"):
        raise VideoSourceError("Video source URL is invalid")
    try:
        parts = urllib.parse.urlsplit(raw)
        host = (parts.hostname or "").lower().rstrip(".")
        port = parts.port
    except ValueError as exc:
        raise VideoSourceError("Video source URL is invalid") from exc
    if (
        parts.scheme.lower() != "https" or not host or host not in permitted
        or parts.username is not None or parts.password is not None
        or port not in (None, 443) or parts.fragment
    ):
        raise VideoSourceError("Only allowlisted HTTPS video hosts without embedded credentials are permitted")

    addresses = list(resolve_ips(host))
    if not addresses:
        raise VideoSourceError("Trusted video host has no reachable addresses")
    try:
        if any(not ipaddress.ip_address(address).is_global for address in addresses):
            raise VideoSourceError("Video host resolved to an unsafe non-public address")
    except ValueError as exc:
        raise VideoSourceError("Video host DNS result was invalid") from exc
    return raw


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, msg, headers, newurl):
        return None


def download_trusted_video(
    raw_url: str, destination: Path, *,
    allowed_hosts: Iterable[str], max_bytes: int, timeout: float = 10.0
) -> int:
    """Bounded streaming download: no redirects, no internal/private hosts."""
    url = trusted_https_video_url(raw_url, allowed_hosts)
    if max_bytes <= 0:
        raise VideoSourceError("Invalid configured upload size limit")
    request = urllib.request.Request(url, headers={
        "User-Agent": "VisionGuardLocalAnalyzer/1.0",
        "Accept": "video/*,application/octet-stream",
    })
    opener = urllib.request.build_opener(_RejectRedirects())
    downloaded = 0
    try:
        with opener.open(request, timeout=timeout) as response:
            if response.geturl() != url:
                raise VideoSourceError("Remote video redirect is not permitted")
            claimed_size = response.headers.get("Content-Length")
            if claimed_size is not None and int(claimed_size) > max_bytes:
                raise VideoSourceError("Remote video exceeds the configured size limit")
            with destination.open("wb") as file:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    downloaded += len(chunk)
                    if downloaded > max_bytes:
                        raise VideoSourceError("Remote video exceeds the configured size limit")
                    file.write(chunk)
        if downloaded == 0:
            raise VideoSourceError("Remote video was empty")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        if destination.exists():
            destination.unlink()
        if isinstance(exc, VideoSourceError):
            raise
        raise VideoSourceError("Remote video could not be retrieved securely") from exc
    return downloaded
