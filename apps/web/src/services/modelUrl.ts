/** Map this project's one public Hugging Face model onto the same-origin
 * Cloudflare Worker streaming endpoint. A /blob URL is a webpage, while
 * /resolve redirects may not provide browser CORS.
 * Keep local development and other model URLs unchanged. */
export const CLOUDFLARE_MODEL_ROUTE = '/api/model/yolo11s.onnx';

const EXPECTED_HF_PREFIX = '/SyedNazeer07/visionguard-yolo11s';

export function resolveDeployedModelUrl(
  configuredUrl: string | undefined,
  production: boolean,
): string {
  const source = configuredUrl?.trim() || '/models/yolo11s.onnx';
  if (!production) return source;
  try {
    const url = new URL(source);
    if (url.origin !== 'https://huggingface.co' ||
        url.search || url.hash) return source;
    if (url.pathname === EXPECTED_HF_PREFIX + '/blob/main/yolo11s.onnx' ||
        url.pathname === EXPECTED_HF_PREFIX + '/resolve/main/yolo11s.onnx') {
      return CLOUDFLARE_MODEL_ROUTE;
    }
  } catch { /* Relative local paths are valid. */ }
  return source;
}
