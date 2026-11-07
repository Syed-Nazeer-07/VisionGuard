/** ONNX Runtime tensors can own GPU resources beyond the JS object lifetime.
 * Release all outputs and the input even if inference/decode failed.
 * Never let a disposal error mask the original inference result.
 */
export interface InferenceDisposable { dispose(): void }

export function disposeInferenceResources(
  input: InferenceDisposable | null,
  outputs: Record<string, InferenceDisposable | undefined> | null,
  reportError: (error: unknown) => void = () => {},
): void {
  const released = new Set<InferenceDisposable>();
  for (const value of [...Object.values(outputs ?? {}), input]) {
    if (!value || released.has(value)) continue;
    released.add(value);
    try { value.dispose(); }
    catch (error) { reportError(error); }
  }
}
