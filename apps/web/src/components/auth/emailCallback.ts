import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { supabase, supabaseConfig } from '../../lib/supabase';

export function parseEmailCallback(url: URL) {
  const fragment = new URLSearchParams(url.hash.slice(1));
  const type = fragment.get('type');
  return {
    hash: fragment.get('token_hash'),
    accessToken: fragment.get('access_token'),
    hasRefreshToken: fragment.has('refresh_token'),
    type,
    failed: fragment.has('error') || url.searchParams.has('error'),
  };
}

// The provider consumes implicit callback fragments as part of initialization.
// Capture the initial URL before the React tree mounts or the SDK clears it.
const initialUrl = typeof window === 'undefined' ? null : new URL(window.location.href);
const incoming = initialUrl ? parseEmailCallback(initialUrl) : null;
const legacyType = initialUrl?.pathname === '/reset-password' && incoming?.type === 'recovery' ? 'recovery'
  : ['/login', '/verify-email'].includes(initialUrl?.pathname ?? '') && ['signup', 'email'].includes(incoming?.type ?? '') ? 'email' : null;
let legacySession: Session | null = null;

if (!supabaseConfig.isMock && legacyType && incoming?.accessToken && incoming.hasRefreshToken && !incoming.failed) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
    const callbackEvent = legacyType === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN';
    if (event === callbackEvent && session?.access_token === incoming.accessToken) legacySession = session;
  });
  void supabase.auth.initialize().finally(() => subscription.unsubscribe()).catch(() => {});
}

export const hasLegacyConfirmation = legacyType === 'email';

export async function redeemEmailLink(type: 'email' | 'recovery', tokenHash?: string): Promise<Session | null> {
  if (supabaseConfig.isMock) return null;
  if (tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error || !data.session || (type === 'email' && !data.user?.email_confirmed_at)) return null;
    return data.session;
  }
  if (legacyType !== type || incoming?.failed) return null;
  await supabase.auth.initialize();
  const session = legacySession;
  legacySession = null;
  return session && (type !== 'email' || session.user.email_confirmed_at) ? session : null;
}

export function clearEmailFragment() {
  if (window.location.hash) history.replaceState(history.state, '', window.location.pathname + window.location.search);
}

const pendingKey = 'visionguard:verification-pending';
export const resendDelay = 60_000;
export type PendingEmail = { email: string; retryAt: number };

export function savePendingEmail(value: PendingEmail | null) {
  try {
    if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value));
    else sessionStorage.removeItem(pendingKey);
  } catch { /* Router state is sufficient for the current visit. */ }
}

export function getPendingEmail(): PendingEmail | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null');
    return typeof value?.email === 'string' && Number.isFinite(value.retryAt) ? value : null;
  } catch { return null; }
}
