import { describe, expect, it } from 'vitest';
import { googleProviderStatus } from './googleAuthAvailability';
describe('Google OAuth configuration preflight', () => {
  it('detects an explicitly disabled provider', () => {
    expect(googleProviderStatus({external:{google:false}})).toBe('disabled');
  });
  it('allows a confirmed enabled provider', () => {
    expect(googleProviderStatus({external:{google:true}})).toBe('enabled');
  });
  it('does not mistake missing settings for disabled OAuth', () => {
    expect(googleProviderStatus(null)).toBe('unknown');
    expect(googleProviderStatus({})).toBe('unknown');
    expect(googleProviderStatus({external:{github:true}})).toBe('unknown');
  });
});
