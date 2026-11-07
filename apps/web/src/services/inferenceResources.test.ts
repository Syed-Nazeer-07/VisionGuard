import { describe, expect, it, vi } from 'vitest';
import { disposeInferenceResources } from './inferenceResources';

describe('ONNX frame tensor cleanup', () => {
  it('releases input and output tensors after a completed inference', () => {
    const input = { dispose: vi.fn() };
    const output = { dispose: vi.fn() };
    disposeInferenceResources(input, { boxes: output });
    expect(input.dispose).toHaveBeenCalledOnce();
    expect(output.dispose).toHaveBeenCalledOnce();
  });
  it('does not dispose the same GPU-owned output twice', () => {
    const shared = { dispose: vi.fn() };
    disposeInferenceResources(null, { outputA: shared, outputB: shared });
    expect(shared.dispose).toHaveBeenCalledOnce();
  });
  it('continues releasing other resources when one tensor throws', () => {
    const error = new Error('GPU device lost');
    const bad = { dispose: vi.fn(() => { throw error; }) };
    const good = { dispose: vi.fn() };
    const input = { dispose: vi.fn() };
    const report = vi.fn();
    expect(() => disposeInferenceResources(input, { a: bad, b: good }, report))
      .not.toThrow();
    expect(good.dispose).toHaveBeenCalledOnce();
    expect(input.dispose).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(error);
  });
  it('allows missing resources after a failed early inference', () => {
    expect(() => disposeInferenceResources(null, null)).not.toThrow();
  });
});
