"""Artifact regression tests: speeding provenance must survive gzip and reload."""
import gzip
import json

from app.storage.artifact import ArtifactManager


def test_speeding_event_provenance_survives_artifact_roundtrip(tmp_path):
    events = [{
        "event_id": "track-11-frame-3",
        "track_id": 11,
        "frame_id": 3,
        "media_time": 0.1,
        "speed_kmh": 85.0,
        "speed_limit_kmh": 60.0,
        "tolerance_kmh": 10.0,
        "vehicle_class": "car",
        "confidence": 0.9,
        "bbox": {"x": 100, "y": 200, "w": 60, "h": 45},
        "source_width": 640,
        "source_height": 480,
        "is_calibrated": True,
        "observation_type": "detection",
    }]
    manager = ArtifactManager(artifact_dir=tmp_path)
    path = manager.write_artifact(
        "speed-test",
        {"width": 640, "height": 480, "fps": 30},
        {"speed_violations_count": 1, "is_calibrated": True},
        [{"frame_id": 3, "media_time": 0.1, "tracks": []}],
        events,
    )
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        payload = json.load(stream)
    assert payload["version"] == "1.1"
    assert payload["speeding_events"] == events
    assert payload["summary"]["speed_violations_count"] == len(payload["speeding_events"])
    assert ArtifactManager(artifact_dir=tmp_path).read_artifact("speed-test")["speeding_events"] == events


def test_old_artifact_writer_call_keeps_empty_speeding_event_list(tmp_path):
    manager = ArtifactManager(artifact_dir=tmp_path)
    manager.write_artifact("no-calibration", {}, {"speed_violations_count": 0}, [])
    assert manager.read_artifact("no-calibration")["speeding_events"] == []
