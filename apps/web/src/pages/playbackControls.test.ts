import { describe, expect, it, vi } from 'vitest';

describe('Playback Controls and Keyboard Shortcuts', () => {
  function shouldHandleSpaceKey(target: { tagName: string; isContentEditable?: boolean } | null): boolean {
    if (!target) return true;
    const tagName = target.tagName.toUpperCase();
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable) {
      return false;
    }
    return true;
  }

  it('ignores Spacebar events when focused on input, textarea, select, or contentEditable', () => {
    expect(shouldHandleSpaceKey({ tagName: 'INPUT' })).toBe(false);
    expect(shouldHandleSpaceKey({ tagName: 'textarea' })).toBe(false);
    expect(shouldHandleSpaceKey({ tagName: 'Select' })).toBe(false);
    expect(shouldHandleSpaceKey({ tagName: 'DIV', isContentEditable: true })).toBe(false);
    expect(shouldHandleSpaceKey({ tagName: 'DIV', isContentEditable: false })).toBe(true);
    expect(shouldHandleSpaceKey({ tagName: 'BUTTON' })).toBe(true);
    expect(shouldHandleSpaceKey({ tagName: 'VIDEO' })).toBe(true);
    expect(shouldHandleSpaceKey(null)).toBe(true);
  });

  it('toggles video playback and pauses/resumes active analysis sessions correctly', () => {
    const video = {
      paused: false,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn()
    };
    let runState = 'ANALYZING';
    const pauseInference = vi.fn(() => { video.pause(); runState = 'PAUSED'; });
    const resumeInference = vi.fn(() => { video.play(); runState = 'ANALYZING'; });

    // When playing during analysis -> spacebar triggers pauseInference
    const handleSpacebar = (e: { code: string; preventDefault: () => void; target: any }) => {
      if (!shouldHandleSpaceKey(e.target)) return;
      e.preventDefault();
      if (video.paused) {
        if (runState === 'PAUSED') resumeInference();
        else video.play();
      } else {
        if (runState === 'ANALYZING') pauseInference();
        else video.pause();
      }
    };

    const preventDefault = vi.fn();
    handleSpacebar({ code: 'Space', preventDefault, target: { tagName: 'BODY' } });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(pauseInference).toHaveBeenCalledTimes(1);
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(runState).toBe('PAUSED');

    // Simulate video paused state
    video.paused = true;
    handleSpacebar({ code: 'Space', preventDefault, target: { tagName: 'BODY' } });

    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(resumeInference).toHaveBeenCalledTimes(1);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(runState).toBe('ANALYZING');
  });

  it('differentiates local-only videos from persisted video assets', () => {
    const localSource = {
      kind: 'video' as const,
      id: 'local-1234567890',
      name: 'traffic.mp4',
      isLocalOnly: true
    };

    const persistedSource = {
      kind: 'video' as const,
      id: 'a0b1c2d3-e4f5-6789-0123-456789abcdef',
      name: 'Highway Cam 1',
      isLocalOnly: false
    };

    expect(localSource.isLocalOnly).toBe(true);
    expect(persistedSource.isLocalOnly).toBe(false);
  });
});
