/**
 * Probe a public ONNX model without downloading its weights twice.
 * Some storage providers allow cross-origin GET but reject HEAD (405/403 or
 * a CORS preflight failure). That should not permanently disable detection.
 */
export type ModelFetcher = (url: string, init: RequestInit) => Promise<Response>;

function isHtml(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

function unavailable(status: number): Error {
  return new Error('YOLO11s model unavailable (HTTP ' + status +
    '). Check VITE_YOLO_MODEL_URL or provide /models/yolo11s.onnx.');
}

function invalidModelPage(): Error {
  return new Error('Expected YOLO11s ONNX model but received an HTML page. ' +
    'The model file may be missing or a single-page-app fallback intercepted the URL.');
}

/**
 * HEAD is cheap and preferred. When the host blocks HEAD but permits GET,
 * probe only a small range and cancel the response body immediately.
 */
export async function verifyOnnxModelUrl(
  url: string,
  fetcher: ModelFetcher = (path, init) => fetch(path, init),
): Promise<void> {
  let head: Response | null = null;
  try {
    head = await fetcher(url, { method: 'HEAD', mode: 'cors' });
  } catch {
    // The provider may allow GET while denying HEAD/CORS for HEAD.
  }
  if (head?.ok) {
    if (isHtml(head)) throw invalidModelPage();
    return;
  }
  // A missing object is not a HEAD compatibility problem.
  if (head?.status === 404 || head?.status === 410) throw unavailable(head.status);

  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET', mode: 'cors', headers: { Range: 'bytes=0-31' },
    });
  } catch (error) {
    throw new Error('Cannot access YOLO11s model. Check public HTTPS model URL, ' +
      'GET/CORS permissions and connectivity. ' +
      (error instanceof Error ? error.message : String(error)));
  }
  try {
    if (!response.ok) throw unavailable(response.status);
    if (isHtml(response)) throw invalidModelPage();
  } finally {
    // Range may be ignored by a provider. Prevent a full secondary download;
    // ONNX Runtime will fetch the actual model only when initializing.
    if (response.body) {
      try { await response.body.cancel(); } catch { /* best-effort cancellation */ }
    }
  }
}
