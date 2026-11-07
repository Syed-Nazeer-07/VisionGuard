import { describe, expect, it } from 'vitest';
import { shouldLoadAuthenticatedProfile } from './authSessionEvents';

describe('Supabase session restoration', () => {
  it('loads profile data for an existing restored session', () => {
    expect(shouldLoadAuthenticatedProfile('INITIAL_SESSION')).toBe(true);
  });
  it('loads fresh or refreshed sessions', () => {
    for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'PASSWORD_RECOVERY'] as const) {
      expect(shouldLoadAuthenticatedProfile(event)).toBe(true);
    }
  });
  it('never treats sign-out as an authenticated profile load', () => {
    expect(shouldLoadAuthenticatedProfile('SIGNED_OUT')).toBe(false);
  });
});
