import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowUpRight, LockKeyhole, Mail, User } from 'lucide-react';
import { supabase, supabaseConfig } from '../../lib/supabase';
import { checkGoogleProvider } from '../../services/googleAuthAvailability';
import { useAuthStore } from '../../store/auth';
import { workspaceReturn } from '../../components/auth/workspaceReturn';
import { AuthCardLayout } from '../../components/auth/AuthCardLayout';
import { AuthField } from '../../components/auth/AuthField';
import { getPendingEmail, hasLegacyConfirmation, resendDelay, savePendingEmail } from '../../components/auth/emailCallback';
import { VerifyEmail } from './VerifyEmail';

const email = z.string().trim().email('Enter a valid email address');
const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password') });
const signupSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your name'),
  email,
  password: z.string().min(8, 'Use at least 8 characters'),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

function GoogleIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
    <path fill="#4285F4" d="M21.35 12.2c0-.67-.06-1.32-.18-1.95H12v3.7h5.23a4.5 4.5 0 0 1-1.94 2.95v2.45h3.14c1.83-1.7 2.92-4.2 2.92-7.15z"/>
    <path fill="#34A853" d="M12 21.5c2.63 0 4.84-.87 6.45-2.35l-3.14-2.45c-.88.59-1.99.93-3.31.93-2.54 0-4.7-1.72-5.47-4.04H3.29v2.51A9.75 9.75 0 0 0 12 21.5z"/>
    <path fill="#FBBC05" d="M6.53 13.59A5.9 5.9 0 0 1 6.2 12c0-.55.11-1.09.33-1.59V7.9H3.29a9.7 9.7 0 0 0 0 8.2z"/>
    <path fill="#EA4335" d="M12 6.37c1.43 0 2.7.49 3.71 1.46l2.79-2.79A9.43 9.43 0 0 0 12 2.5a9.75 9.75 0 0 0-8.71 5.4l3.24 2.51C7.3 8.09 9.46 6.37 12 6.37z"/>
  </svg>;
}

function CredentialsForm({ signup }: { signup: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useAuthStore(state => state.session);
  const initialized = useAuthStore(state => state.initialized);
  const returnPath = workspaceReturn(location.state?.from);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const emailDefault = typeof location.state?.email === 'string' ? location.state.email : '';
  const login = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: emailDefault } });
  const registration = useForm<z.infer<typeof signupSchema>>({ resolver: zodResolver(signupSchema), defaultValues: { email: emailDefault } });
  const callbackError = new URLSearchParams(location.search).has('error');

  useEffect(() => {
    if (!initialized || !session || callbackError) return;
    let oauthReturn: unknown;
    try {
      oauthReturn = JSON.parse(sessionStorage.getItem('visionguard:oauth-return') ?? 'null');
      sessionStorage.removeItem('visionguard:oauth-return');
    } catch { /* Sign-in can proceed without storage. */ }
    savePendingEmail(null);
    navigate(returnPath === '/app' ? workspaceReturn(oauthReturn) : returnPath, { replace: true });
  }, [initialized, session, callbackError, returnPath, navigate]);

  async function submit(credentials: z.infer<typeof loginSchema> & { fullName?: string }) {
    setError('');
    if (supabaseConfig.isMock) {
      setError('Account sign-in is unavailable because the workspace has no Auth connection.');
      return;
    }
    setBusy('email');
    try {
      if (signup) {
        const { data, error } = await supabase.auth.signUp({
          email: credentials.email, password: credentials.password,
          options: { emailRedirectTo: new URL('/login', window.location.origin).href, data: { full_name: credentials.fullName } },
        });
        if (error) throw error;
        if (!data.session && data.user) {
          const pending = { email: credentials.email, retryAt: Date.now() + resendDelay };
          savePendingEmail(pending);
          navigate('/verify-email', { state: { pending }, replace: true });
        } else if (!data.session) {
          setError('Could not start registration. Try again.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword(credentials);
        if (error?.code === 'email_not_confirmed') {
          const previous = getPendingEmail();
          const pending = previous?.email === credentials.email ? previous : { email: credentials.email, retryAt: Date.now() };
          savePendingEmail(pending);
          navigate('/verify-email', { state: { pending }, replace: true });
        } else if (error) throw error;
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not continue. Try again.');
    } finally { setBusy(null); }
  }

  async function google() {
    setError('');
    if (supabaseConfig.isMock) { setError('Google sign-in is unavailable for this workspace.'); return; }
    setBusy('google');
    try {
      const availability = await checkGoogleProvider(supabaseConfig.url, supabaseConfig.anonKey);
      if (availability === 'disabled') throw new Error('Google sign-in is unavailable. Use an email address to continue.');
      try { sessionStorage.setItem('visionguard:oauth-return', JSON.stringify(location.state?.from ?? null)); } catch { /* Optional return path. */ }
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google', options: { redirectTo: new URL('/login', window.location.origin).href },
      });
      if (error) throw error;
    } catch (reason) {
      try { sessionStorage.removeItem('visionguard:oauth-return'); } catch { /* Storage may be disabled. */ }
      setError(reason instanceof Error ? reason.message : 'Could not start Google sign-in.');
      setBusy(null);
    }
  }

  const credentialsFields = signup ? registration.formState : login.formState;
  const emailField = signup ? registration.register('email') : login.register('email');
  const passwordField = signup ? registration.register('password') : login.register('password');
  return <AuthCardLayout title={signup ? 'Create your account' : 'Sign in to VisionGuard'}
    subtitle={signup ? 'Create a workspace to analyze traffic footage and save your findings.' : 'Open your traffic analysis workspace.'}
    signInLink={false}>
    {(error || callbackError) && <p role="alert" className="vg-auth-notice">{error || 'Sign-in could not be completed. Try again.'}</p>}
    <form noValidate onSubmit={signup ? registration.handleSubmit(submit) : login.handleSubmit(submit)} aria-busy={busy === 'email'}>
      {signup && <AuthField id="signup-name" label="Full name" icon={User} autoComplete="name"
        {...registration.register('fullName')} error={registration.formState.errors.fullName?.message}/>}
      <AuthField id={signup ? 'signup-email' : 'login-email'} label="Email address" icon={Mail} type="email"
        autoComplete="username" placeholder="you@example.com" {...emailField} error={credentialsFields.errors.email?.message}/>
      <AuthField id={signup ? 'signup-password' : 'login-password'} label="Password" icon={LockKeyhole} type="password"
        autoComplete={signup ? 'new-password' : 'current-password'} hint={signup ? 'Use at least 8 characters.' : undefined}
        {...passwordField} error={credentialsFields.errors.password?.message}/>
      {signup ? <AuthField id="signup-confirmPassword" label="Confirm password" icon={LockKeyhole} type="password"
        autoComplete="new-password" {...registration.register('confirmPassword')} error={registration.formState.errors.confirmPassword?.message}/>
        : <Link to="/forgot-password" className="vg-auth-forgot">Forgot password?</Link>}
      <button type="submit" className="vg-primary" disabled={busy !== null}>
        {busy === 'email' ? 'Please wait…' : signup ? 'Create account' : 'Sign in'} <ArrowUpRight size={16}/>
      </button>
    </form>
    <div className="vg-auth-divider">or</div>
    <button className="vg-secondary" type="button" disabled={busy !== null} onClick={() => void google()}>
      <GoogleIcon/>{busy === 'google' ? 'Connecting…' : 'Continue with Google'}
    </button>
    <p className="vg-auth-alternate">{signup ? 'Already have an account?' : 'New to VisionGuard?'}{' '}
      <Link replace to={signup ? '/login' : '/register'} state={{ from: location.state?.from }}>
        {signup ? 'Sign in' : 'Create an account'}
      </Link>
    </p>
  </AuthCardLayout>;
}


export function Login() {
  const { pathname, key } = useLocation();
  if (pathname === '/login' && hasLegacyConfirmation && key === 'default') return <VerifyEmail/>;
  return <CredentialsForm key={pathname} signup={pathname === '/register'}/>;
}
