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
