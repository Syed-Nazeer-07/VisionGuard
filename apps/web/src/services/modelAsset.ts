/** The configured detector is a public, self-contained ONNX file. */
export async function downloadModelAsset(path: string, fetcher: typeof fetch = fetch): Promise<Uint8Array<ArrayBuffer>> {
  let response: Response;
  try {
    response = await fetcher(path, { credentials: 'omit', mode: 'cors' });
  } catch (cause) {
    throw new Error('Could not download the ONNX model. Check the connection and the model URL’s CORS settings.', { cause });
  }
  if (!response.ok || response.status === 206) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Model download failed (HTTP ' + response.status + '). Check the configured ONNX URL.');
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    void response.body?.cancel().catch(() => {});
    throw new Error('The model URL returned a web page or API response. Provide a direct ONNX download URL.');
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    throw new Error('The model download was interrupted. Check the connection and retry.', { cause });
  }
  const header = new TextDecoder().decode(bytes.subarray(0, 80)).trimStart();
  if (bytes.length < 1024 || header.startsWith('<') || header.startsWith('{')) {
    throw new Error('The model download is incomplete or is not an ONNX binary.');
  }
  return bytes;
}
