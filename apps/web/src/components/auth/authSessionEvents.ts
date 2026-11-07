import type { AuthChangeEvent } from '@supabase/supabase-js';

/**
 * Session restoration must be treated as a real authentication event.
 * Ignoring INITIAL_SESSION can invalidate the concurrent bootstrap request
 * and leave an already signed-in user on the login screen.
 */
export function shouldLoadAuthenticatedProfile(event: AuthChangeEvent): boolean {
  return event === 'INITIAL_SESSION' ||
    event === 'SIGNED_IN' ||
    event === 'TOKEN_REFRESHED' ||
    event === 'USER_UPDATED' ||
    event === 'PASSWORD_RECOVERY';
}
