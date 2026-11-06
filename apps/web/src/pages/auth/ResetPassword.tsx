import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { AuthRecoveryLayout, recoveryButton, recoveryInput } from './AuthRecoveryLayout';

const resetSchema = z.object({
  password: z.string().min(8, 'Use at least 8 characters for your new password'),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match', path: ['confirmPassword']
});
type ResetForm = z.infer<typeof resetSchema>;

export function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<ResetForm>({
    resolver: zodResolver(resetSchema)
  });

  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: string, session: unknown) => {
        if (!active) return;
        if (session) { setReady(true); setVerifying(false); }
      }
    );
    void supabase.auth.getSession().then(({ data: { session } }: any) => {
      if (!active) return;
      if (session) { setReady(true); setVerifying(false); }
      else {
        // Allow the Auth client to finish exchanging the recovery URL code.
        window.setTimeout(() => {
          if (active) setVerifying(false);
        }, 1600);
      }
    }).catch(() => { if (active) setVerifying(false); });
    return () => { active = false; subscription?.unsubscribe(); };
  }, []);

  const save = async (data: ResetForm) => {
    setSaving(true);
    setError(null);
    try {
      const { data: result, error: authError } = await supabase.auth.updateUser({ password: data.password });
      if (authError) throw authError;
      if (result?.user) {
        // Preserve the original first-time account activation workflow.
        const { data: profile } = await supabase.from('profiles')
          .select('status').eq('id', result.user.id).maybeSingle();
        if (profile?.status === 'Pending') {
          const { error: activateError } = await supabase.from('profiles')
            .update({ status: 'Active', accepted_at: new Date().toISOString() }).eq('id', result.user.id);
          if (activateError) console.warn('Profile activation requires review:', activateError);
        }
      }
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password could not be changed. Please request a new link.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthRecoveryLayout
      eyebrow="Secure account recovery"
      title="Set a new password"
      description="Choose a strong password to restore access to your VisionGuard workspace."
    >
      {verifying ? (
        <div role="status" className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl text-sm text-slate-600">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" /> Verifying your recovery link…
        </div>
      ) : !ready ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <AlertCircle className="w-6 h-6 text-amber-600 mb-3" />
          <h2 className="text-base font-semibold text-slate-900">This link is invalid or has expired</h2>
          <p className="text-sm text-slate-600 mt-2">Open the latest recovery email or request a fresh link.</p>
          <Link to="/forgot-password" className="inline-flex mt-4 text-sm font-semibold text-indigo-700 hover:underline">
            Request another reset link
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit(save)} noValidate className="space-y-5">
          <div>
            <label htmlFor="new-password" className="block mb-2 text-sm font-semibold text-slate-700">New password</label>
            <div className="relative">
              <KeyRound className="absolute top-3.5 left-3.5 w-4 h-4 text-slate-400" />
              <input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                {...register('password')} aria-invalid={!!errors.password} placeholder="At least 8 characters"
                className={`${recoveryInput} pl-10 pr-12`} />
              <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3.5 text-slate-500 hover:text-indigo-700">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {errors.password && <p role="alert" className="text-xs text-rose-600 mt-2">{errors.password.message}</p>}
          </div>
          <div>
            <label htmlFor="confirm-new-password" className="block mb-2 text-sm font-semibold text-slate-700">Confirm new password</label>
            <input id="confirm-new-password" type={showPassword ? 'text' : 'password'}
              autoComplete="new-password" {...register('confirmPassword')} aria-invalid={!!errors.confirmPassword}
              placeholder="Repeat your new password" className={recoveryInput} />
            {errors.confirmPassword && <p role="alert" className="text-xs text-rose-600 mt-2">{errors.confirmPassword.message}</p>}
          </div>
          {error && <div role="alert" className="flex items-start gap-2 border border-rose-200 bg-rose-50 rounded-xl p-3 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>}
          <button type="submit" disabled={saving} className={recoveryButton}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {saving ? 'Updating password…' : 'Update password'}
          </button>
          <p className="text-center text-xs text-slate-500">
            Need a new link? <Link to="/forgot-password" className="font-semibold text-indigo-700 hover:underline">Request one</Link>
          </p>
        </form>
      )}
    </AuthRecoveryLayout>
  );
}
