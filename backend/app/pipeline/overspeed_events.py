"""Count speeding episodes instead of counting every overspeed frame.

Only fresh detector observations advance hysteresis. Interpolated / predicted
tracks must not create enforcement events. A new episode requires three
consecutive speeding observations; it closes after three consecutive
non-speeding observations. This avoids multiplying one event by the video's FPS.
"""

from dataclasses import dataclass, field
from typing import Dict


@dataclass
class _TrackEpisode:
    high_streak: int = 0
    clear_streak: int = 0
    active: bool = False


@dataclass
class OverspeedEventCounter:
    confirmation_frames: int = 3
    clearing_frames: int = 3
    count: int = 0
    _tracks: Dict[int, _TrackEpisode] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.confirmation_frames < 1 or self.clearing_frames < 1:
            raise ValueError("Confirmation and clearing thresholds must be positive")

    def observe(self, track_id: int, is_overspeed: bool, *, observed: bool = True) -> bool:
        """Return True only on the frame that confirms a new speeding episode."""
        if not observed:
            return False

        state = self._tracks.setdefault(track_id, _TrackEpisode())
        if is_overspeed:
            state.clear_streak = 0
            if not state.active:
                state.high_streak += 1
                if state.high_streak >= self.confirmation_frames:
                    state.active = True
                    self.count += 1
                    return True
        else:
            state.high_streak = 0
            if state.active:
                state.clear_streak += 1
                if state.clear_streak >= self.clearing_frames:
                    state.active = False
                    state.clear_streak = 0
        return False
