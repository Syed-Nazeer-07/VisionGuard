import { describe, expect, it } from 'vitest';
import { resolveDeployedModelUrl, CLOUDFLARE_MODEL_ROUTE } from './modelUrl';

const url = 'https://huggingface.co/SyedNazeer07/visionguard-yolo11s';

describe('hosted YOLO11s source', () => {
  it('routes Hugging Face /blob model viewer links through the Cloudflare Worker', () => {
    expect(resolveDeployedModelUrl(url + '/blob/main/yolo11s.onnx', true))
      .toBe(CLOUDFLARE_MODEL_ROUTE);
  });
  it('also proxies the actual /resolve file link for CORS protection', () => {
    expect(resolveDeployedModelUrl(url + '/resolve/main/yolo11s.onnx', true))
      .toBe(CLOUDFLARE_MODEL_ROUTE);
  });
  it('does not change local development model paths or other hosted models', () => {
    expect(resolveDeployedModelUrl(url + '/resolve/main/yolo11s.onnx', false))
      .toBe(url + '/resolve/main/yolo11s.onnx');
    expect(resolveDeployedModelUrl(undefined, true)).toBe('/models/yolo11s.onnx');
    expect(resolveDeployedModelUrl('https://example.org/model.onnx', true))
      .toBe('https://example.org/model.onnx');
  });
  it('does not proxy attacker-controlled Hugging Face repositories or query tokens', () => {
    expect(resolveDeployedModelUrl('https://huggingface.co/Other/model/resolve/main/yolo11s.onnx', true))
      .not.toBe(CLOUDFLARE_MODEL_ROUTE);
    expect(resolveDeployedModelUrl(url + '/resolve/main/yolo11s.onnx?token=secret', true))
      .not.toBe(CLOUDFLARE_MODEL_ROUTE);
  });
});
