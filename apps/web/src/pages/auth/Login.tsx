import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { supabase, supabaseConfig } from '../../lib/supabase';
import { checkGoogleProvider } from '../../services/googleAuthAvailability';
import { useAuthStore } from '../../store/auth';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Mail, Lock, User, Building, AlertTriangle, CheckCircle2 } from 'lucide-react';
import './AuthTheme.css';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  rememberMe: z.boolean().optional(),
});

const registerSchema = z.object({
  fullName: z.string().min(2, 'Full name is required'),
  organization: z.string().min(2, 'Organization is required'),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type LoginForm = z.infer<typeof loginSchema>;
type RegisterForm = z.infer<typeof registerSchema>;

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  
  const session = useAuthStore(state => state.session);
  const initialized = useAuthStore(state => state.initialized);

  useEffect(() => {
    if (initialized && session) {
      navigate('/app', { replace: true });
    }
  }, [initialized, session, navigate]);

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  
  useEffect(() => {
    // An unsuccessful external OAuth flow returns to /login with an error.
    // Keep the message visible instead of silently bouncing through /app.
    const query = new URLSearchParams(location.search);
    if (query.has('error')) {
      const message = query.get('error_description') || 'Google sign-in was not completed.';
      setError(message.replace(/\+/g, ' ').slice(0, 250));
      navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (location.pathname === '/register') {
      setMode('register');
    }
  }, [location]);

  const {
    register: registerLogin,
    handleSubmit: handleLoginSubmit,
    formState: { errors: loginErrors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const {
    register: registerSignup,
    handleSubmit: handleSignupSubmit,
    formState: { errors: signupErrors },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const onLogin = async (data: LoginForm) => {
    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);
    
    sessionStorage.removeItem('visionguard_logged_out');
    
    if (supabaseConfig.isMock) {
      setIsLoading(false);
      setError('Authentication is not configured. Set up the Supabase Auth environment and retry. Demo admin sign-in is disabled for security.');
      return;
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      setIsLoading(false);

      if (error) {
        setError(error.message);
      } else {
        navigate('/app', { replace: true });
      }
    } catch (err: any) {
      setIsLoading(false);
      setError(err?.message || 'Authentication failed');
    }
  };

  const onGoogleContinue = async () => {
    setError(null);
    setSuccessMsg(null);
    if (supabaseConfig.isMock) {
      setError('Google sign-in requires a configured Supabase Auth connection.');
      return;
    }
    setIsGoogleLoading(true);
    try {
      sessionStorage.removeItem('visionguard_logged_out');
      // GoTrue may otherwise redirect to a raw HTTP 400 page when Google is
      // disabled; show an actionable local error before starting OAuth.
      const status = await checkGoogleProvider(supabaseConfig.url, supabaseConfig.anonKey);
      if (status === 'disabled') {
        throw new Error('Google sign-in is disabled in this Supabase project. Enable the Google provider under Supabase Authentication → Providers, then configure your Google OAuth Client ID, Client Secret and redirect URLs.');
      }
      // Supabase handles OAuth state and session persistence. Fixed callback.
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: new URL('/login', window.location.origin).toString() },
      });
      if (oauthError) throw oauthError;
      // When Supabase starts a redirect, the browser leaves this page.
      // Do not show a misleading "connected" success before it returns.
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start Google sign-in.');
      setIsGoogleLoading(false);
    }
  };

  const onSignup = async (data: RegisterForm) => {
    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);
    
    if (supabaseConfig.isMock) {
      setIsLoading(false);
      setError('Registration requires configured Supabase Auth. Local mock administrator accounts are not supported.');
      return;
    }

    try {
      const { data: signupResult, error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          emailRedirectTo: new URL('/login', window.location.origin).toString(),
          data: {
            full_name: data.fullName,
            organization: data.organization
          }
        }
      });

      setIsLoading(false);

      if (error) {
        setError(error.message);
      } else {
        setSuccessMsg(signupResult.session
          ? 'Your account is ready. You can sign in using the email and password you just chose.'
          : 'Check your email for a VisionGuard confirmation link. After confirming, return here to sign in. Check spam if you do not see it.');
        // Keep the confirmation instructions visible. Automatically removing
        // them after two seconds made activation appear to be broken.
      }
    } catch (err: any) {
      setIsLoading(false);
      setError(err?.message || 'Registration failed');
    }
  };

  const switchMode = (newMode: 'login' | 'register') => {
    setError(null);
    setSuccessMsg(null);
    setMode(newMode);
    if (newMode === 'login') navigate('/login', { replace: true });
    if (newMode === 'register') navigate('/register', { replace: true });
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="vg-auth min-h-screen flex bg-[#f5f6f4]"
    >
      
      {/* Left Panel - Roadway Surveillance Showcase (Dedicated Sign In Visual Panel) */}
      <div className="vg-auth-showcase hidden lg:flex lg:w-[48%] xl:w-[52%] relative bg-[#1d2428] flex-col justify-between p-12 xl:p-16 overflow-hidden text-white select-none">
        {/* Photorealistic Roadway CCTV Surveillance Background Image */}
        <div className="vg-auth-photo absolute inset-0 z-0">
          <img 
            src="/signin_hero.jpg" 
            alt="VisionGuard Roadway CCTV Surveillance" 
            className="w-full h-full object-cover object-center"
          />
          {/* Subtle dark gradient scrim matching navy and indigo palette */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#161d20] via-[#1d2428]/80 to-[#1d2428]/60" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#161d20]/70 via-transparent to-[#161d20]/55" />
        </div>
        
        {/* Top Brand Logo & Status Indicator */}
        <div className="relative z-10 flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-2.5 group">
            <img src="/brand-mark.svg?v=20261111" alt="" width={36} height={36} className="w-9 h-9 rounded-lg" />
            <span className="text-xl font-bold text-white tracking-tight">VisionGuard</span>
          </Link>
          <div className="vg-auth-secure inline-flex items-center gap-2 px-3 py-2 rounded-full backdrop-blur-md text-[10px] font-semibold tracking-[0.13em]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d9e1e2]"></span>
            <span>SECURE ACCESS</span>
          </div>
        </div>

        {/* Center Editorial Content */}
        <div className="relative z-10 my-auto py-8">
          <div className="max-w-[480px]">
            <div className="vg-auth-kicker inline-flex items-center px-3 py-2 mb-7 rounded text-[10px] font-semibold tracking-[0.17em] uppercase">
              VISIONGUARD / YOUR WORKSPACE
            </div>
            <h1 className="vg-auth-headline text-4xl xl:text-[52px] font-semibold text-white leading-[1.11] mb-5 tracking-[-0.055em]">
              A clearer view starts here.
            </h1>
            <p className="text-[15px] text-[#bec7ca] leading-[1.8] mb-8">
              Analyze traffic footage, follow the movement, and return to the insights that matter—all from one workspace.
            </p>
          </div>
          
          <div className="vg-auth-tags mt-8 flex flex-wrap gap-2.5 text-xs text-[#e6e9e7]">
            <span className="rounded-md border border-white/15 bg-slate-950/40 px-3 py-2">Video analysis</span>
            <span className="rounded-md border border-white/15 bg-slate-950/40 px-3 py-2">Vehicle tracking</span>
            <span className="rounded-md border border-white/15 bg-slate-950/40 px-3 py-2">Activity reports</span>
          </div>
        </div>

        {/* Bottom Security / Copyright */}
        <div className="relative z-10 flex items-center justify-between text-xs text-[#acb9bb] border-t border-white/20 pt-5">
          <span>Role-based workspace access</span>
          <span>VisionGuard</span>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="vg-auth-form w-full lg:w-[52%] xl:w-[48%] flex flex-col items-center justify-center p-6 sm:p-12 bg-[#f5f6f4] relative min-h-screen lg:h-screen overflow-y-auto">
        
        {/* Mobile Logo Header */}
        <div className="absolute top-8 left-8 lg:hidden flex items-center space-x-2">
          <Link to="/" className="flex items-center space-x-2">
            <img src="/brand-mark.svg?v=20261111" alt="" width={32} height={32} className="h-8 w-8 rounded-lg" />
            <span className="text-xl font-bold text-gray-900 tracking-tight">VisionGuard</span>
          </Link>
        </div>

        <div className="vg-auth-form-inner w-full max-w-[440px] m-auto flex flex-col justify-center">
          
          {/* Header / Tabs - Underline Style */}
          <div className="mb-8">
            <div className="vg-auth-tabs flex space-x-9 border-b mb-7 relative">
              <button
                onClick={() => switchMode('login')}
                className={cn(
                  "pb-3.5 text-[15px] font-semibold relative transition-colors cursor-pointer outline-none",
                  mode === 'login' ? "text-gray-900" : "text-gray-400 hover:text-gray-600"
                )}
              >
                Sign In
                {mode === 'login' && (
                  <motion.div
                    layoutId="auth-tab-underline"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#283239]"
                    initial={false}
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
              </button>
              
              <button
                onClick={() => switchMode('register')}
                className={cn(
                  "pb-3.5 text-[15px] font-semibold relative transition-colors cursor-pointer outline-none",
                  mode === 'register' ? "text-gray-900" : "text-gray-400 hover:text-gray-600"
                )}
              >
                Create Account
                {mode === 'register' && (
                  <motion.div
                    layoutId="auth-tab-underline"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#283239]"
                    initial={false}
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
              </button>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={mode}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="text-[28px] font-semibold text-[#242d32] mb-2 tracking-[-.045em]">
                  {mode === 'login' ? 'Sign in to VisionGuard' : 'Create your account'}
                </h2>
                <p className="text-[#6a767b] text-[14px] leading-[1.7]">
                  {mode === 'login' 
                    ? 'Access your workspace, analysis history, and reports.' 
                    : 'Join your workspace with standard user access.'}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Error / Success Alerts */}
          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="overflow-hidden"
              >
                <div className="p-3.5 bg-red-50 border border-red-100 text-red-600 rounded-lg text-[14px] font-medium flex items-start shadow-sm">
                  <AlertTriangle className="w-5 h-5 mr-2 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              </motion.div>
            )}
            {successMsg && (
              <motion.div 
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="overflow-hidden"
              >
                <div className="p-3.5 bg-green-50 border border-green-100 text-green-700 rounded-lg text-[14px] font-medium flex items-start shadow-sm">
                  <CheckCircle2 className="w-5 h-5 mr-2 flex-shrink-0" />
                  <span className="flex-1">{successMsg}
                    {mode === 'register' && <button type="button"
                      onClick={() => switchMode('login')}
                      className="mt-2 block text-xs font-semibold underline underline-offset-2">
                      Go to sign in
                    </button>}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Forms Container */}
          <div className="relative">
            <AnimatePresence mode="wait">
              {mode === 'login' ? (
                <motion.form
                  key="login"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2 }}
                  onSubmit={handleLoginSubmit(onLogin)}
                  className="space-y-3.5"
                >
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">Email</label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Mail className="h-[18px] w-[18px] text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                      </div>
                      <input
                        type="email"
                        placeholder="you@example.com"
                        {...registerLogin('email')}
                        className={cn(
                          "w-full pl-10 pr-4 py-3 bg-white border rounded-lg outline-none transition-all text-[14px] text-gray-900 placeholder:text-gray-400 shadow-sm",
                          loginErrors.email ? "border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500" : "border-gray-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 hover:border-gray-300"
                        )}
                      />
                    </div>
                    {loginErrors.email && <p className="mt-1 text-[13px] text-red-500 font-medium">{loginErrors.email.message}</p>}
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">Password</label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Lock className="h-[18px] w-[18px] text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                      </div>
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        {...registerLogin('password')}
                        className={cn(
                          "w-full pl-10 pr-10 py-3 bg-white border rounded-lg outline-none transition-all text-[14px] text-gray-900 placeholder:text-gray-400 shadow-sm",
                          loginErrors.password ? "border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500" : "border-gray-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 hover:border-gray-300"
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer outline-none rounded p-0.5"
                      >
                        {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
                      </button>
                    </div>
                    {loginErrors.password && <p className="mt-1 text-[13px] text-red-500 font-medium">{loginErrors.password.message}</p>}
                  </div>

                  <div className="flex justify-between items-center pt-1 pb-2">
                    <label className="flex items-center space-x-2 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        {...registerLogin('rememberMe')}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-900 focus:ring-offset-1 cursor-pointer transition-colors" 
                      />
                      <span className="text-[13px] font-medium text-gray-600 group-hover:text-gray-900 transition-colors">Remember me</span>
                    </label>
                    <Link to="/forgot-password" className="text-[13px] font-medium text-gray-500 hover:text-gray-900 transition-colors">
                      Forgot password?
                    </Link>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="vg-auth-submit w-full flex justify-center items-center h-[49px] rounded-lg text-white font-semibold disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <div className="flex items-center justify-center space-x-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        <span className="text-[14px]">Authenticating...</span>
                      </div>
                    ) : (
                      <span className="text-[14px]">Sign in</span>
                    )}
                  </button>
                </motion.form>
              ) : (
                <motion.form
                  key="register"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  onSubmit={handleSignupSubmit(onSignup)}
                  className="space-y-3.5"
                >
                  <div className="grid grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">Full Name</label>
                      <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <User className="h-[18px] w-[18px] text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                        </div>
                        <input
                          type="text"
                          placeholder="Sarah Jenkins"
                          {...registerSignup('fullName')}
                          className={cn(
                            "w-full pl-10 pr-3 py-3 bg-white border rounded-lg outline-none transition-all text-[14px] text-gray-900 placeholder:text-gray-400 shadow-sm",
                            signupErrors.fullName ? "border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500" : "border-gray-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 hover:border-gray-300"
                          )}
                        />
                      </div>
                      {signupErrors.fullName && <p className="mt-1 text-[13px] text-red-500 font-medium">{signupErrors.fullName.message}</p>}
                    </div>
                    <div>
                      <label className="block text-[12px] font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">Organization</label>
                      <div className="relative group">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Building className="h-[18px] w-[18px] text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                        </div>
                        <input
                          type="text"
                          placeholder="Dept. of Transport"
                          {...registerSignup('organization')}
                          className={cn(
                            "w-full pl-10 pr-3 py-3 bg-white border rounded-lg outline-none transition-all text-[14px] text-gray-900 placeholder:text-gray-400 shadow-sm",
                            signupErrors.organization ? "border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500" : "border-gray-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 hover:border-gray-300"
                          )}
                        />
                      </div>
                      {signupErrors.organization && <p className="mt-1 text-[13px] text-red-500 font-medium">{signupErrors.organization.message}</p>}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">Email</label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Mail className="h-[18px] w-[18px] text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                      </div>
                      <input
                        type="email"
                        placeholder="you@example.com"
                        {...registerSignup('email')}
                        className={cn(
                          "w-full pl-10 pr-4 py-3 bg-white border rounded-lg outline-none transition-all text-[14px] text-gray-900 placeholder:text-gray-400 shadow-sm",
                          signupErrors.email ? "border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500" : "border-gray-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 hover:border-gray-300"
                        )}
                      />
                    </div>
                    {signupErrors.email && <p className="mt-1 text-[13px] text-red-500 font-medium">{signupErrors.email.message}</p>}
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">Password</label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Lock className="h-[18px] w-[18px] text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                      </div>
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        {...registerSignup('password')}
                        className={cn(
                          "w-full pl-10 pr-10 py-3 bg-white border rounded-lg outline-none transition-all text-[14px] text-gray-900 placeholder:text-gray-400 shadow-sm",
                          signupErrors.password ? "border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500" : "border-gray-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 hover:border-gray-300"
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer outline-none rounded p-0.5"
                      >
                        {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
                      </button>
                    </div>
                    {signupErrors.password && <p className="mt-1 text-[13px] text-red-500 font-medium">{signupErrors.password.message}</p>}
                  </div>

                  <div>
                    <label className="block text-[12px] font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">Confirm Password</label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Lock className="h-[18px] w-[18px] text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                      </div>
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="••••••••"
                        {...registerSignup('confirmPassword')}
                        className={cn(
                          "w-full pl-10 pr-10 py-3 bg-white border rounded-lg outline-none transition-all text-[14px] text-gray-900 placeholder:text-gray-400 shadow-sm",
                          signupErrors.confirmPassword ? "border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500" : "border-gray-200 focus:border-gray-900 focus:ring-1 focus:ring-gray-900 hover:border-gray-300"
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer outline-none rounded p-0.5"
                      >
                        {showConfirmPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
                      </button>
                    </div>
                    {signupErrors.confirmPassword && <p className="mt-1 text-[13px] text-red-500 font-medium">{signupErrors.confirmPassword.message}</p>}
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="vg-auth-submit mt-2 w-full flex justify-center items-center h-[49px] rounded-lg text-white font-semibold disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <div className="flex items-center justify-center space-x-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        <span className="text-[14px]">Creating Account...</span>
                      </div>
                    ) : (
                      <span className="text-[14px]">Create Account</span>
                    )}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-6">
            <div className="flex items-center gap-3 pb-5 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200"/>
              <span>or continue with</span>
              <span className="h-px flex-1 bg-slate-200"/>
            </div>
            <button type="button" onClick={() => void onGoogleContinue()}
              disabled={isLoading || isGoogleLoading}
              className="vg-google-button flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
              <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
                <path fill="#4285F4" d="M21.35 12.2c0-.67-.06-1.32-.18-1.95H12v3.7h5.23a4.5 4.5 0 0 1-1.94 2.95v2.45h3.14c1.83-1.7 2.92-4.2 2.92-7.15z"/>
                <path fill="#34A853" d="M12 21.5c2.63 0 4.84-.87 6.45-2.35l-3.14-2.45c-.88.59-1.99.93-3.31.93-2.54 0-4.7-1.72-5.47-4.04H3.29v2.51A9.75 9.75 0 0 0 12 21.5z"/>
                <path fill="#FBBC05" d="M6.53 13.59A5.9 5.9 0 0 1 6.2 12c0-.55.11-1.09.33-1.59V7.9H3.29A9.7 9.7 0 0 0 2.25 12c0 1.58.38 3.07 1.04 4.1l3.24-2.51z"/>
                <path fill="#EA4335" d="M12 6.37c1.43 0 2.7.49 3.71 1.46l2.79-2.79A9.43 9.43 0 0 0 12 2.5a9.75 9.75 0 0 0-8.71 5.4l3.24 2.51C7.3 8.09 9.46 6.37 12 6.37z"/>
              </svg>
              {isGoogleLoading ? 'Connecting to Google…' : 'Continue with Google'}
            </button>
            <p className="mt-4 text-center text-xs leading-5 text-slate-500">
              Access permissions are assigned by the workspace. New accounts do not receive administrator access.
            </p>
          </div>

        </div>
      </div>
    </motion.div>
  );
}
