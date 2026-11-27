import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MailCheck, Send } from 'lucide-react';
import { AuthCardLayout } from '../../components/auth/AuthCardLayout';
import { clearEmailFragment, getPendingEmail, hasLegacyConfirmation, parseEmailCallback, redeemEmailLink, resendDelay, savePendingEmail } from '../../components/auth/emailCallback';
import { supabase, supabaseConfig } from '../../lib/supabase';

export function VerifyEmail() {
  const location = useLocation();
  const [pending, setPending] = useState(() => location.state?.pending ?? getPendingEmail());
  const [callback] = useState(() => parseEmailCallback(new URL(window.location.href)));
  const token = callback.type === 'email' ? callback.hash : null;
  const [status, setStatus] = useState<'pending' | 'linked' | 'checking' | 'verified' | 'invalid'>(
    callback.failed ? 'invalid' : token ? 'linked' : hasLegacyConfirmation ? 'checking' : pending ? 'pending' : 'invalid'
  );
  const attempt = useRef<Promise<boolean> | null>(null);
  const [now, setNow] = useState(Date.now);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const remaining = Math.max(0, Math.ceil(((pending?.retryAt ?? 0) - now) / 1000));

  useEffect(() => {
    if (status !== 'checking') return;
    attempt.current ??= redeemEmailLink('email', token ?? undefined).then(Boolean).catch(() => false);
    let active = true;
    void attempt.current.then(verified => {
      if (!active) return;
      clearEmailFragment();
      if (verified) savePendingEmail(null);
      setStatus(verified ? 'verified' : 'invalid');
    });
    return () => { active = false; };
  }, [status, token]);

  useEffect(() => {
    if (status !== 'pending' || !remaining) return;
    const timer = window.setTimeout(() => setNow(Date.now()), 1000);
    return () => window.clearTimeout(timer);
  }, [status, remaining]);

  async function resend() {
    if (!pending || remaining || sending) return;
    setMessage('');
    setError('');
    if (supabaseConfig.isMock) { setError('Email confirmation is unavailable for this workspace.'); return; }
    setSending(true);
    const updated = { ...pending, retryAt: Date.now() + resendDelay };
    setPending(updated);
    savePendingEmail(updated);
    setNow(Date.now());
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup', email: pending.email,
        options: { emailRedirectTo: new URL('/login', window.location.origin).href },
      });
      if (error) throw error;
      setMessage('Check your inbox and spam folder for a new confirmation message.');
    } catch {
      setError('Could not request another confirmation link. Wait for the countdown before trying again.');
    } finally { setSending(false); }
  }

  if (status === 'linked' || status === 'checking') return <AuthCardLayout title="Confirm your email"
    subtitle="Verify this email address to finish setting up your VisionGuard account.">
    <button className="vg-primary" type="button" disabled={status === 'checking'} onClick={() => setStatus('checking')}>
      <MailCheck size={17}/>{status === 'checking' ? 'Checking your link…' : 'Confirm email address'}
    </button>
  </AuthCardLayout>;

  if (status === 'verified') return <AuthCardLayout title="Email verified"
    subtitle="Your email address is confirmed. Your VisionGuard workspace is ready." signInLink={false}>
    <Link to="/app" className="vg-primary">Open workspace</Link>
  </AuthCardLayout>;

  if (status === 'invalid') return <AuthCardLayout title="Check your confirmation link"
    subtitle="This link may have expired or already been used. You can request a fresh link or sign in if you have already confirmed your email.">
    {pending ? <button type="button" className="vg-primary" onClick={() => setStatus('pending')}>Request another link</button>
      : <Link to="/register" className="vg-primary">Return to registration</Link>}
  </AuthCardLayout>;

  return <AuthCardLayout title="Check your email"
    subtitle={<>Look for the confirmation link at <strong>{pending?.email}</strong>. Check your spam folder if it doesn’t appear in your inbox.</>}>
    <div className="vg-auth-stack">
      {error && <p role="alert" className="vg-auth-notice">{error}</p>}
      {message && <p role="status" className="vg-auth-help">{message}</p>}
      <button className="vg-primary" type="button" disabled={sending || remaining > 0} onClick={() => void resend()}>
        <Send size={16}/>{sending ? 'Requesting link…' : remaining ? `Resend available in ${remaining}s` : 'Resend confirmation link'}
      </button>
      <Link className="vg-secondary" to="/register" state={{ email: pending?.email }}
        onClick={() => savePendingEmail(null)}>Correct email address</Link>
    </div>
  </AuthCardLayout>;
}
