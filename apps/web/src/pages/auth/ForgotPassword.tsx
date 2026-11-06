import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { CheckCircle2, Mail, Send, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { AuthRecoveryLayout, recoveryButton, recoveryInput } from './AuthRecoveryLayout';

const forgotSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
});
type ForgotForm = z.infer<typeof forgotSchema>;

export function ForgotPassword() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema)
  });

  const sendLink = async (data: ForgotForm) => {
    setError(null);
    setSuccess(false);
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(data.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (authError) throw authError;
      // Do not reveal whether an account exists for this email.
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a recovery link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthRecoveryLayout
      eyebrow="Account recovery"
      title="Forgot your password?"
      description="Enter your work email. If it belongs to an account, we’ll send a secure password reset link."
    >
      {success ? (
        <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mb-3" />
          <h2 className="font-semibold text-slate-900">Check your inbox</h2>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            If an account exists for that address, an email with a recovery link is on its way.
            Check your spam folder too.
          </p>
          <button type="button" onClick={() => setSuccess(false)}
            className="mt-5 text-sm font-semibold text-indigo-700 hover:underline">Try another email</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit(sendLink)} className="space-y-5" noValidate>
          <div>
            <label htmlFor="recovery-email" className="block text-sm font-semibold text-slate-700 mb-2">Email address</label>
            <div className="relative">
              <Mail className="absolute top-3.5 left-3.5 w-4 h-4 text-slate-400" />
              <input id="recovery-email" type="email" autoComplete="email" placeholder="you@organization.com"
                {...register('email')} aria-invalid={!!errors.email}
                className={`${recoveryInput} pl-10`} />
            </div>
            {errors.email && <p role="alert" className="mt-2 text-xs text-rose-600">{errors.email.message}</p>}
          </div>
          {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>}
          <button type="submit" disabled={loading} className={recoveryButton}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {loading ? 'Sending secure link…' : 'Send password reset link'}
          </button>
          <p className="text-xs text-center text-slate-500 leading-relaxed">
            Remembered your password? <Link to="/login" className="text-indigo-700 font-semibold hover:underline">Sign in</Link>
          </p>
        </form>
      )}
    </AuthRecoveryLayout>
  );
}
