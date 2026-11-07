/**
 * A browser-tab share is explicitly approved by the user. Selecting a tab
 * typically hides the app, so losing foreground visibility must NOT end it.
 * Device-camera capture remains privacy-sensitive and stops on hide.
 */
export type ActiveCaptureKind = 'tab' | 'camera' | null;
export function hiddenPagePolicy(kind: ActiveCaptureKind): {
  pauseMedia: boolean;
  releaseCapture: boolean;
} {
  return {
    pauseMedia: kind !== 'tab',
    releaseCapture: kind === 'camera',
  };
}

/** Preview playback can be suspended by a browser while focus is elsewhere. */
export function shouldResumeSharedTab(kind: ActiveCaptureKind, pageHidden: boolean, previewPaused: boolean): boolean {
  return kind === 'tab' && !pageHidden && previewPaused;
}

/**
 * Only a browser-tab share can remain connected across the app. Device
 * cameras must always be stopped on navigation, even if this option is on.
 */
export function keepCaptureAcrossPages(kind: ActiveCaptureKind, userOptedIn: boolean): boolean {
  return kind === 'tab' && userOptedIn;
}
