import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_INACTIVITY_TIMEOUT_MS, INITIALIZATION_TIMEOUT_MS,
  startupTimeoutMs, shouldRetryStartupOnWasm
} from './detectorStartupPolicy';

describe('YOLO startup recovery policy', () => {
  it('permits slow downloads while bytes continue arriving', () => {
    expect(startupTimeoutMs('downloading')).toBe(DOWNLOAD_INACTIVITY_TIMEOUT_MS);
    expect(startupTimeoutMs('downloading')).toBeGreaterThan(startupTimeoutMs('initializing'));
  });

  it('limits model initialization and never loops endlessly after switching to WASM', () => {
    expect(startupTimeoutMs('initializing')).toBe(INITIALIZATION_TIMEOUT_MS);
    expect(shouldRetryStartupOnWasm('initializing', false)).toBe(true);
    expect(shouldRetryStartupOnWasm('initializing', true)).toBe(false);
    expect(shouldRetryStartupOnWasm('downloading', false)).toBe(false);
  });
});
