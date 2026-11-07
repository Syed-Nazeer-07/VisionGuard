import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Send } from 'lucide-react';
import { supabase, supabaseConfig } from '../../lib/supabase';
import { AuthCardLayout } from '../../components/auth/AuthCardLayout';

const schema = z.object({ email: z.string().email('Enter a valid email address') });
type FormValues = z.infer<typeof schema>;

export function ForgotPassword() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema)
  });

  const submit = async ({ email }: FormValues) => {
    setError('');
    setMessage('');
    if (supabaseConfig.isMock) {
      setError('Password recovery requires a configured Supabase Auth connection.');
      return;
    }
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: new URL('/reset-password', window.location.origin).toString()
      });
      if (authError) throw authError;
      // Avoid exposing whether an account exists for this address.
      setMessage('If an account uses this address, a reset link will arrive shortly. Check your inbox and spam folder.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request the reset link.');
    } finally {
      setLoading(false);
    }
  };

  return <AuthCardLayout title="Reset your password"
    subtitle="Enter the email linked to your workspace account. We'll email a secure password reset link.">
    {error && <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    {message && <div role="status" className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900">{message}</div>}
    <form onSubmit={handleSubmit(submit)} className="space-y-5">
      <div>
        <label htmlFor="recovery-email" className="mb-2 block text-xs font-semibold text-slate-700">Email address</label>
        <div className="relative">
          <Mail size={17} className="pointer-events-none absolute left-3 top-[12px] text-slate-400"/>
          <input id="recovery-email" type="email" autoComplete="email"
            placeholder="you@example.com" {...register('email')}
            className="vg-field w-full pl-10" aria-invalid={!!errors.email}/>
        </div>
        {errors.email && <p className="mt-2 text-xs text-red-600">{errors.email.message}</p>}
      </div>
      <button type="submit" disabled={loading} className="vg-primary w-full">
        <Send size={16}/> {loading ? 'Sending link…' : 'Send reset link'}
      </button>
    </form>
    <p className="mt-5 text-xs leading-5 text-slate-500">
      For security, links expire. If yours has expired, request a new one here.
    </p>
  </AuthCardLayout>;
}
