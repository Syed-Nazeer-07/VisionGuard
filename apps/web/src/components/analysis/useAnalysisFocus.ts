import { useEffect, useState } from 'react';

/**
 * Focus is a UI-only theater mode; it must not reset or remount the video.
 * The analysis component is retained across workspace routes, so leaving
 * its route must always dismiss the overlay.
 */
export function useAnalysisFocus(active: boolean) {
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => {
    if (!active) setFocusMode(false);
  }, [active]);

  useEffect(() => {
    if (!focusMode) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.fullscreenElement) return;
      event.preventDefault();
      setFocusMode(false);
    };
    window.addEventListener('keydown', exitOnEscape);
    return () => window.removeEventListener('keydown', exitOnEscape);
  }, [focusMode]);

  return { focusMode, setFocusMode };
}
