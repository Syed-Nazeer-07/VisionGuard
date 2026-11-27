import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Send } from 'lucide-react';
import { supabase, supabaseConfig } from '../../lib/supabase';
import { AuthCardLayout } from '../../components/auth/AuthCardLayout';
import { AuthField } from '../../components/auth/AuthField';

const schema = z.object({ email: z.string().trim().email('Enter a valid email address') });
type FormValues = z.infer<typeof schema>;

export function ForgotPassword() {
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function submit({ email }: FormValues) {
    setError('');
    if (supabaseConfig.isMock) {
      setError('Password recovery is unavailable for this workspace.');
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: new URL('/reset-password', window.location.origin).href
      });
      if (error && (!error.status || error.status >= 500)) throw error;
      setRequested(true);
    } catch {
      setError('The recovery service is temporarily unavailable. Try again in a few minutes.');
    }
  }

  if (requested) return <AuthCardLayout title="Check your email"
    subtitle="If an account exists for this email address, you’ll receive a secure password reset link shortly.">
    <div className="vg-auth-stack">
      <p className="vg-auth-help" role="status">Check your inbox and spam folder. Open the newest link if you requested more than one.</p>
      <button type="button" className="vg-secondary" onClick={() => setRequested(false)}>Use another email address</button>
    </div>
  </AuthCardLayout>;

  return <AuthCardLayout title="Reset your password" subtitle="Enter the email address associated with your account.">
    {error && <p role="alert" className="vg-auth-notice">{error}</p>}
    <form noValidate onSubmit={handleSubmit(submit)} aria-busy={isSubmitting}>
      <AuthField id="recovery-email" label="Email address" icon={Mail} type="email" autoComplete="email"
        placeholder="you@example.com" {...register('email')} error={errors.email?.message}/>
      <button type="submit" disabled={isSubmitting} className="vg-primary"><Send size={16}/> {isSubmitting ? 'Requesting link…' : 'Send reset link'}</button>
    </form>
  </AuthCardLayout>;
}
