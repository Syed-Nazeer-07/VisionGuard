/** Version-pinned public runtime assets avoid Cloudflare Workers' 25 MiB
 * static file limit for ONNX Runtime Web's 29.5 MiB JSEP WASM binary. */
export const ORT_WASM_CDN_VERSION = '1.30.0';
export const ORT_WASM_CDN_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' +
  ORT_WASM_CDN_VERSION + '/dist/';
export function ortWasmAssetsPath(isDev: boolean): string {
  // Vite's dev server serves matching artifacts locally; only the production
  // build uses the matching-version public CDN for WASM and JSEP modules.
  return isDev ? '/' : ORT_WASM_CDN_BASE;
}
