import { afterEach, describe, expect, it, vi } from 'vitest';

const { verifyOtp, onAuthStateChange, initialize } = vi.hoisted(() => ({
  verifyOtp: vi.fn(), onAuthStateChange: vi.fn(), initialize: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { verifyOtp, onAuthStateChange, initialize } },
  supabaseConfig: { isMock: false },
}));

async function load(path: string) {
  vi.resetModules();
  window.history.replaceState(null, '', path);
  return import('./emailCallback');
}

afterEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('email callback proof', () => {
  it('does not accept an ordinary session on the reset route', async () => {
    const { redeemEmailLink } = await load('/reset-password');
    expect(await redeemEmailLink('recovery')).toBeNull();
    expect(onAuthStateChange).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('waits for the provider and rejects an unverified email result', async () => {
    const { redeemEmailLink } = await load('/verify-email#type=email&token_hash=fixture');
    const session = { access_token: 'verified-session' };
    verifyOtp.mockResolvedValueOnce({ data: { session, user: {} }, error: null });
    expect(await redeemEmailLink('email', 'fixture')).toBeNull();
    verifyOtp.mockResolvedValueOnce({ data: { session, user: { email_confirmed_at: 'today' } }, error: null });
    expect(await redeemEmailLink('email', 'fixture')).toEqual(session);
    expect(verifyOtp).toHaveBeenLastCalledWith({ type: 'email', token_hash: 'fixture' });
  });

  it('accepts an early matching recovery event exactly once', async () => {
    const session = { access_token: 'callback', user: { id: 'recovering' } };
    onAuthStateChange.mockImplementation(callback => {
      callback('INITIAL_SESSION', { access_token: 'ordinary' });
      callback('PASSWORD_RECOVERY', session);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    initialize.mockResolvedValue({ error: null });
    const { redeemEmailLink } = await load('/reset-password#access_token=callback&refresh_token=proof&type=recovery');
    expect(await redeemEmailLink('recovery')).toEqual(session);
    expect(await redeemEmailLink('recovery')).toBeNull();
  });
});
