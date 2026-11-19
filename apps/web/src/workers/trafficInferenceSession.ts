import type { InferenceSession, Tensor } from 'onnxruntime-web';
import { matchesYoloTensor, YOLO_INPUT_SHAPE, YOLO_OUTPUT_SHAPE } from '../pipeline/detector/liveVehicles';
import type { DetectorProvider, DetectorStartup } from '../pipeline/worker/detectorProtocol';
import { downloadModelAsset } from '../services/modelAsset';
import { ortWasmAssetsPath } from '../services/ortWasmPaths';

type Ort = typeof import('onnxruntime-web');
type AdapterInfo = NonNullable<DetectorStartup['adapter']> & { isFallbackAdapter?: boolean };
type Adapter = Ort['env']['webgpu']['adapter'] & { info?: AdapterInfo };
const clock = () => performance.now();

async function getAdapter(provider: DetectorProvider) {
  const started = clock();
  if (provider === 'wasm') return { adapter: null, adapterMs: 0, reason: '' };
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu;
  let reason = 'No hardware adapter was available.';
  try {
    const adapter = await gpu?.requestAdapter();
    if (adapter?.info?.isFallbackAdapter) reason = 'The browser reported a software adapter.';
    else if (adapter) return { adapter, adapterMs: clock() - started, reason: '' };
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  return { adapter: null, adapterMs: clock() - started, reason };
}

export async function openTrafficSession(
  path: string, preferredProvider: DetectorProvider,
  onStage: (stage: 'downloading' | 'initializing') => void,
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void,
): Promise<{
  session: InferenceSession; Tensor: typeof Tensor;
  provider: 'webgpu' | 'wasm'; startup: DetectorStartup; fallbackReason: string;
}> {
  onStage('downloading');
  const downloadStarted = clock();
  const [asset, selection] = await Promise.all([
    downloadModelAsset(path, fetch, onProgress).then(bytes => {
      onStage('initializing');
      return { bytes, downloadMs: clock() - downloadStarted };
    }),
    getAdapter(preferredProvider)
  ]);
  const startup: DetectorStartup = {
    downloadMs: asset.downloadMs, modelBytes: asset.bytes.byteLength, adapterMs: selection.adapterMs,
    runtimeImportMs: 0, sessionMs: 0, validationMs: 0
  };

  const create = async (provider: 'webgpu' | 'wasm') => {
    const importStarted = clock();
    const ort = provider === 'webgpu' ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm');
    startup.runtimeImportMs += clock() - importStarted;
    // The CPU-only binary fits the asset limit and ships with the app.
    // The larger WebGPU binary still uses the version-pinned CDN.
    if (provider === 'webgpu' || import.meta.env.DEV) {
      ort.env.wasm.wasmPaths = ortWasmAssetsPath(import.meta.env.DEV);
    }
    if (provider === 'webgpu' && selection.adapter) ort.env.webgpu.adapter = selection.adapter;
    const sessionStarted = clock();
    try {
      const session = await ort.InferenceSession.create(asset.bytes, { executionProviders: [provider] });
      if (provider === 'wasm') startup.wasmThreads = ort.env.wasm.numThreads;
      return { session, Tensor: ort.Tensor };
    } finally {
      startup.sessionMs += clock() - sessionStarted;
    }
  };

  let provider: 'webgpu' | 'wasm' = selection.adapter ? 'webgpu' : 'wasm';
  let fallbackReason = selection.reason;
  let created;
  try {
    created = await create(provider);
  } catch (error) {
    if (provider === 'wasm') throw error;
    fallbackReason = error instanceof Error ? error.message : String(error);
    provider = 'wasm';
    created = await create(provider);
  }

  const validationStarted = clock();
  const { inputMetadata, outputMetadata } = created.session;
  if (inputMetadata.length !== 1 || outputMetadata.length !== 1 ||
      !matchesYoloTensor(inputMetadata[0], YOLO_INPUT_SHAPE) ||
      !matchesYoloTensor(outputMetadata[0], YOLO_OUTPUT_SHAPE)) {
    await created.session.release();
    throw new Error('Incompatible model. Use a float32 COCO ONNX export with input [1,3,640,640] and output [1,84,8400].');
  }
  startup.validationMs = clock() - validationStarted;
  if (provider === 'webgpu' && selection.adapter?.info) {
    const { vendor, architecture, device, description } = selection.adapter.info;
    startup.adapter = { vendor, architecture, device, description };
  }
  return { ...created, provider, startup, fallbackReason };
}
