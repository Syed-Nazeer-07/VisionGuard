/**
 * Turn storage configuration failures into actionable user-facing messages.
 * B2 is optional; failure to configure it must not imply detection failed.
 * Never render server environment variable names or secret-related details.
 */
export type CloudVideoFailure = {
  kind: 'not_configured' | 'other';
  message: string;
};
export function describeCloudVideoFailure(raw: unknown): CloudVideoFailure {
  const message = raw instanceof Error ? raw.message :
    typeof raw === 'string' ? raw : String(raw ?? '');
  if (/video storage is not configured on the server|missing:\\s*B2_(?:ENDPOINT|REGION|BUCKET|KEY_ID|APPLICATION_KEY)|missing B2_(?:ENDPOINT|REGION|BUCKET|KEY_ID|APPLICATION_KEY)/i.test(message)) {
    return {
      kind: 'not_configured',
      message: 'Cloud video backup is not configured on this server. Your analysis is still saved, but the original video was not uploaded. Enable “Keep this video on this device” to retain it here. Backblaze B2 credentials must be set up by the app owner to enable cloud playback.',
    };
  }
  return {
    kind: 'other',
    message: message.trim() || 'Cloud video upload failed. You can still keep the original on this device.',
  };
}
