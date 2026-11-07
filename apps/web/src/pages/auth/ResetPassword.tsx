import { useEffect, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase, supabaseConfig } from '../../lib/supabase';
import { AuthCardLayout } from '../../components/auth/AuthCardLayout';

const resetSchema = z.object({
  password: z.string().min(8, 'Use at least 8 characters'),
  confirmPassword: z.string()
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match', path: ['confirmPassword']
});
type ResetForm = z.infer<typeof resetSchema>;

export function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<ResetForm>({
    resolver: zodResolver(resetSchema)
  });

  useEffect(() => {
    if (supabaseConfig.isMock) {
      setVerifying(false);
      return;
    }
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (mounted && event === 'PASSWORD_RECOVERY' && session) {
        setReady(true);
        setVerifying(false);
      }
    });
    void supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      if (!mounted) return;
      setReady(Boolean(session));
      setVerifying(false);
    }).catch(() => {
      if (mounted) setVerifying(false);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  const submit = async ({ password }: ResetForm) => {
    setError('');
    if (!ready) {
      setError('The reset link has expired or is invalid. Request a new link.');
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
      // The reset page must never modify the account's role, activation
      // status or privileged audit fields. Those are server-managed.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password update failed.');
    } finally {
      setLoading(false);
    }
  };

  return <AuthCardLayout title="Choose a new password"
    subtitle="Secure your account with a new password. The reset link must still be valid.">
    {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {done ? <div className="space-y-5">
      <div role="status" className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <CheckCircle2 size={20}/> Your password has been updated successfully.
      </div>
      <Link to="/login" className="vg-primary w-full">Continue to sign in</Link>
    </div> : verifying ?
      <p className="text-sm text-slate-500">Checking your reset link…</p> :
      !ready ? <div className="space-y-4">
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          This reset link could not be verified. It may have expired or already been used.
        </p>
        <Link to="/forgot-password" className="vg-primary w-full">Request a new link</Link>
      </div> :
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div>
          <label htmlFor="new-password" className="mb-2 block text-xs font-semibold text-slate-700">New password</label>
          <input id="new-password" type="password" autoComplete="new-password"
            {...register('password')} className="vg-field w-full" aria-invalid={!!errors.password}/>
          {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>}
        </div>
        <div>
          <label htmlFor="confirm-password" className="mb-2 block text-xs font-semibold text-slate-700">Confirm new password</label>
          <input id="confirm-password" type="password" autoComplete="new-password"
            {...register('confirmPassword')} className="vg-field w-full"
            aria-invalid={!!errors.confirmPassword}/>
          {errors.confirmPassword && <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>}
        </div>
        <button type="submit" disabled={loading} className="vg-primary w-full">
          <LockKeyhole size={16}/> {loading ? 'Updating password…' : 'Update password'}
        </button>
      </form>}
  </AuthCardLayout>;
}
