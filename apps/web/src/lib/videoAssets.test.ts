import { describe, expect, it } from 'vitest';
import { canReanalyzeStoredVideo } from './videoAssets';
describe('archive availability', () => {
  it('disables cloud replay for metadata-only entries', () => {
    expect(canReanalyzeStoredVideo({storage_path:null,metadata:null})).toBe(false);
    expect(canReanalyzeStoredVideo({storage_path:null,metadata:{artifact_storage_path:'report.json'}})).toBe(false);
  });
  it('allows a completed stored object path', () => {
    expect(canReanalyzeStoredVideo({storage_path:'uploads/video.mp4',metadata:null})).toBe(true);
  });
  it('rejects explicitly failed or incomplete uploads', () => {
    expect(canReanalyzeStoredVideo({storage_path:'uploads/video.mp4',metadata:{upload_status:'failed'}})).toBe(false);
    expect(canReanalyzeStoredVideo({storage_path:null,metadata:{upload_status:'uploading'}})).toBe(false);
  });
});
