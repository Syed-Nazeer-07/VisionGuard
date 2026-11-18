import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOriginalKey, isUuid } from '../supabase/functions/video-storage/objectPaths.mjs';

const videoId = '18a91262-f881-4790-93c1-a083e0f8398e';
const otherId = '7dc97c5f-7d05-4af4-9a95-0c863b108491';

test('accepts only canonical UUIDs used by the video asset lookup', () => {
  assert.equal(isUuid(videoId), true);
  for (const value of [null, '', '------------------------------------', videoId.replaceAll('-', '')]) {
    assert.equal(isUuid(value), false);
  }
});

test('limits B2 original requests to the selected asset’s exact object layout', () => {
  assert.equal(isOriginalKey(videoId, `videos/${videoId}/original.webm`), true);
  for (const key of [
    `videos/${otherId}/original.webm`,
    `videos/${videoId}/nested/original.webm`,
    `videos/${videoId}/original.webm.tmp`,
    `artifacts/${videoId}/original.webm`,
    `videos/${videoId}/original.webm?temporary=value`,
  ]) assert.equal(isOriginalKey(videoId, key), false);
});
