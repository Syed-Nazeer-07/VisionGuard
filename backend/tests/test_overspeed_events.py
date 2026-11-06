import pytest

from app.pipeline.overspeed_events import OverspeedEventCounter


def test_single_continuous_speeding_vehicle_counts_once():
    counter = OverspeedEventCounter()
    transitions = [counter.observe(7, True) for _ in range(40)]
    assert transitions.count(True) == 1
    assert transitions[2] is True
    assert counter.count == 1


def test_brief_speed_spikes_and_one_false_frame_do_not_create_more_events():
    counter = OverspeedEventCounter()
    assert counter.observe(9, True) is False
    assert counter.observe(9, True) is False
    assert counter.observe(9, False) is False
    assert counter.count == 0
    assert [counter.observe(9, True) for _ in range(3)] == [False, False, True]
    counter.observe(9, False)
    assert counter.observe(9, True) is False
    assert counter.count == 1


def test_second_episode_after_three_clear_observations():
    counter = OverspeedEventCounter()
    for _ in range(3):
        counter.observe(42, True)
    for _ in range(3):
        counter.observe(42, False)
    assert [counter.observe(42, True) for _ in range(3)] == [False, False, True]
    assert counter.count == 2


def test_tracks_are_independent():
    counter = OverspeedEventCounter()
    for _ in range(3):
        assert counter.observe(1, True) in (True, False)
        counter.observe(2, True)
    assert counter.count == 2


def test_predictions_do_not_count_or_reset_episodes():
    counter = OverspeedEventCounter()
    assert counter.observe(4, True) is False
    assert counter.observe(4, True, observed=False) is False
    assert counter.observe(4, True, observed=False) is False
    assert counter.observe(4, True) is False
    assert counter.observe(4, True) is True
    for _ in range(5):
        assert counter.observe(4, False, observed=False) is False
    assert counter.observe(4, True) is False
    assert counter.count == 1


def test_invalid_thresholds_rejected():
    with pytest.raises(ValueError):
        OverspeedEventCounter(confirmation_frames=0)
    with pytest.raises(ValueError):
        OverspeedEventCounter(clearing_frames=0)
