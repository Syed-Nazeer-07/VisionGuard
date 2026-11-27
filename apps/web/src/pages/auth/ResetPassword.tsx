import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AuthCardLayout } from '../../components/auth/AuthCardLayout';
import { AuthField } from '../../components/auth/AuthField';
import { clearEmailFragment, parseEmailCallback, redeemEmailLink } from '../../components/auth/emailCallback';

const resetSchema = z.object({
  password: z.string().min(8, 'Use at least 8 characters'),
  confirmPassword: z.string()
}).refine(data => data.password === data.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });
type ResetForm = z.infer<typeof resetSchema>;

export function ResetPassword() {
  const [callback] = useState(() => parseEmailCallback(new URL(window.location.href)));
  const token = callback.type === 'recovery' ? callback.hash : null;
  const [status, setStatus] = useState<'linked' | 'checking' | 'invalid' | 'ready' | 'done'>(callback.failed ? 'invalid' : token ? 'linked' : 'checking');
  const redeemed = useRef<Promise<Session | null> | null>(null);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ResetForm>({ resolver: zodResolver(resetSchema) });

  useEffect(() => {
    if (status !== 'checking') return;
    redeemed.current ??= redeemEmailLink('recovery', token ?? undefined).catch(() => null);
    let active = true;
    void redeemed.current.then(session => {
      if (!active) return;
      clearEmailFragment();
      setStatus(session ? 'ready' : 'invalid');
    });
    return () => { active = false; };
  }, [status, token]);

  async function submit({ password }: ResetForm) {
    setError('');
    try {
      const verified = await redeemed.current;
      const { data: { session } } = await supabase.auth.getSession();
      if (!verified || !session || verified.access_token !== session.access_token) {
        setStatus('invalid');
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus('done');
      // Close the recovery login so the user can sign in with their new password.
      await supabase.auth.signOut({ scope: 'local' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update your password.');
    }
  }

  if (status === 'linked' || status === 'checking') return <AuthCardLayout title="Verify your reset link"
    subtitle="Continue to verify the password reset request.">
    <button type="button" className="vg-primary" disabled={status === 'checking'} onClick={() => setStatus('checking')}>
      <LockKeyhole size={16}/>{status === 'checking' ? 'Checking your link…' : 'Continue to reset'}
    </button>
  </AuthCardLayout>;

  if (status === 'invalid') return <AuthCardLayout title="Request a new reset link"
    subtitle="This link could not be verified. It may have expired or already been used.">
    <Link to="/forgot-password" className="vg-primary">Request a new link</Link>
  </AuthCardLayout>;

  if (status === 'done') return <AuthCardLayout title="Password updated"
    subtitle="Use your new password the next time you sign in." signInLink={false}>
    <Link to="/login" className="vg-primary">Continue to sign in</Link>
  </AuthCardLayout>;

  return <AuthCardLayout title="Choose a new password" subtitle="Choose a strong password for your VisionGuard account.">
    {error && <p role="alert" className="vg-auth-notice">{error}</p>}
    <form noValidate onSubmit={handleSubmit(submit)} aria-busy={isSubmitting}>
      <AuthField id="new-password" label="New password" icon={LockKeyhole} type="password" autoComplete="new-password"
        hint="Use at least 8 characters." {...register('password')} error={errors.password?.message}/>
      <AuthField id="confirm-password" label="Confirm new password" icon={LockKeyhole} type="password"
        autoComplete="new-password" {...register('confirmPassword')} error={errors.confirmPassword?.message}/>
      <button type="submit" disabled={isSubmitting} className="vg-primary">{isSubmitting ? 'Updating…' : 'Update password'}</button>
    </form>
  </AuthCardLayout>;
}
