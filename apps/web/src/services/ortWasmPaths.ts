/** Vite resolves this constant from the *installed* ONNX Runtime Web package
 * during build. The same-version public CDN supplies its oversized JSEP WASM
 * so Workers static assets stay within their 25 MiB per-file limit. */
declare const __ORT_WASM_CDN_BASE__: string;
export const ORT_WASM_CDN_BASE = __ORT_WASM_CDN_BASE__;
export function ortWasmAssetsPath(isDev: boolean): string {
  // Dev serves package artifacts from the local Vite middleware; Cloudflare
  // production loads the identical-version public CDN binary and glue code.
  return isDev ? '/' : ORT_WASM_CDN_BASE;
}
