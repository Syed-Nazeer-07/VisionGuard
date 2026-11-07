import { describe, expect, it } from 'vitest';
import { savedLocalMatchesArchive } from './localVideoRecovery';

const local = { name: 'Road Footage.mp4', file: new Blob(['contents']) };
describe('archived video recovery from opted-in local retention', () => {
  it('finds a local video only when its name AND size match', () => {
    expect(savedLocalMatchesArchive({
      filename: 'road footage.mp4', file_size: 8
    }, local)).toBe(true);
  });
  it('refuses unrelated footage, even if the size or name happens to match', () => {
    expect(savedLocalMatchesArchive({
      filename: 'wrong.mp4', file_size: 8
    }, local)).toBe(false);
    expect(savedLocalMatchesArchive({
      filename: local.name, file_size: 9
    }, local)).toBe(false);
  });
  it('does not silently open a different local video when archive size is unknown', () => {
    expect(savedLocalMatchesArchive({
      filename: local.name, file_size: null
    }, local)).toBe(false);
  });
  it('rejects empty names and invalid file sizes', () => {
    expect(savedLocalMatchesArchive({ filename: ' ', file_size: 8 }, local)).toBe(false);
    expect(savedLocalMatchesArchive({ filename: local.name, file_size: 0 }, local)).toBe(false);
    expect(savedLocalMatchesArchive({ filename: local.name, file_size: NaN }, local)).toBe(false);
  });
});
