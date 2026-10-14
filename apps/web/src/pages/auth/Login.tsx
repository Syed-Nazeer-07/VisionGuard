import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/auth';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Eye, EyeOff, Mail, Lock, User, Building, AlertTriangle, CheckCircle2 } from 'lucide-react';

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
    
    const isMock = !import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL.includes('placeholder');
    if (isMock) {
      setTimeout(() => {
        const demoUser = {
          id: 'demo-admin-id',
          email: data.email || 'admin@transport.gov',
          user_metadata: { full_name: 'System Administrator' },
          app_metadata: {},
          aud: 'authenticated',
          created_at: new Date().toISOString()
        } as any;
        const demoSession = {
          access_token: 'demo-token',
          token_type: 'bearer',
          user: demoUser
        } as any;
        const demoProfile = {
          id: 'demo-admin-id',
          email: data.email || 'admin@transport.gov',
          role: 'Admin',
          status: 'Active',
          name: 'System Administrator',
          organization: 'Department of Transportation'
        };
        localStorage.setItem('visionguard_demo_session', JSON.stringify({ session: demoSession, profile: demoProfile, settings: {} }));
        useAuthStore.getState().setAuth(demoSession, demoProfile, {});
        setIsLoading(false);
        navigate('/app', { replace: true });
      }, 300);
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

  const onSignup = async (data: RegisterForm) => {
    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);
    
    const isMock = !import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL.includes('placeholder');
    if (isMock) {
      setTimeout(() => {
        setIsLoading(false);
        setSuccessMsg('Registration successful! Please sign in.');
        setTimeout(() => {
          setMode('login');
          setSuccessMsg(null);
        }, 1500);
      }, 300);
      return;
    }

    try {
      const { error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            full_name: data.fullName,
            organization: data.organization,
            role: 'Viewer'
          }
        }
      });

      setIsLoading(false);

      if (error) {
        setError(error.message);
      } else {
        setSuccessMsg('Registration successful! Please sign in.');
        setTimeout(() => {
          setMode('login');
          setSuccessMsg(null);
        }, 2000);
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
      className="min-h-screen flex bg-white"
    >
      
      {/* Left Panel - Roadway Surveillance Showcase (Dedicated Sign In Visual Panel) */}
      <div className="hidden lg:flex lg:w-[52%] xl:w-[54%] relative bg-slate-950 flex-col justify-between p-12 xl:p-16 border-r border-slate-800 overflow-hidden text-white select-none">
        {/* Photorealistic Roadway CCTV Surveillance Background Image */}
        <div className="absolute inset-0 z-0">
          <img 
            src="/signin_hero.jpg" 
            alt="VisionGuard Roadway CCTV Surveillance" 
            className="w-full h-full object-cover object-center filter brightness-[0.76] contrast-[1.12]"
          />
          {/* Subtle dark gradient scrim matching navy and indigo palette */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/75 to-slate-950/80" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/80 via-transparent to-slate-950/60" />
        </div>
        
        {/* Top Brand Logo & Status Indicator */}
        <div className="relative z-10 flex items-center justify-between">
          <Link to="/" className="flex items-center space-x-2.5 group">
            <div className="w-9 h-9 rounded-lg bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold text-white tracking-tight">VisionGuard</span>
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700/60 text-xs font-mono text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>SYSTEM ONLINE</span>
          </div>
        </div>

        {/* Center Editorial Content */}
        <div className="relative z-10 my-auto py-8">
          <div className="max-w-[480px]">
            <div className="inline-block px-2.5 py-1 mb-4 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold tracking-wider uppercase font-mono">
              Roadway Surveillance & Control
            </div>
            <h1 className="text-3xl xl:text-4xl font-bold text-white leading-tight mb-4 tracking-tight">
              Real-Time Situational Awareness for Modern Transit Networks
            </h1>
            <p className="text-[15px] text-slate-300 leading-relaxed mb-8">
              Access the VisionGuard Operations Center to monitor active camera streams, analyze flow telemetry, and manage roadway alerts.
            </p>
          </div>
          
          {/* Surveillance Telemetry HUD Card */}
          <div className="rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-800 p-4 shadow-xl max-w-[480px]">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5 mb-3 text-xs font-mono text-slate-400">
              <span className="text-slate-200 font-medium">CAM-09B · INTERSTATE ARTERIAL</span>
              <span className="text-emerald-400">FPS: 29.8 · 1080p</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60">
                <div className="text-[11px] text-slate-400 uppercase">Detection</div>
                <div className="text-sm font-bold text-white mt-0.5">YOLO11-Nano</div>
              </div>
              <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60">
                <div className="text-[11px] text-slate-400 uppercase">Tracking</div>
                <div className="text-sm font-bold text-white mt-0.5">ByteTrack</div>
              </div>
              <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60">
                <div className="text-[11px] text-slate-400 uppercase">Velocity</div>
                <div className="text-sm font-bold text-indigo-300 mt-0.5">Calibrated</div>
              </div>
            </div>
          </div>
          
          {/* Feature Badges */}
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[13px] font-medium text-slate-300">
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Multi-Camera Ingest</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> WebGPU & Local Backend</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Sub-Second Incident Alerting</span>
          </div>
        </div>

        {/* Bottom Security / Copyright */}
        <div className="relative z-10 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/60 pt-4">
          <span>Enterprise Role-Based Access Control</span>
          <span>© 2026 VisionGuard AI</span>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="w-full lg:w-[48%] xl:w-[46%] flex flex-col items-center justify-center p-6 sm:p-12 bg-white relative h-screen overflow-y-auto">
        
        {/* Mobile Logo Header */}
        <div className="absolute top-8 left-8 lg:hidden flex items-center space-x-2">
          <Link to="/" className="flex items-center space-x-2">
            <Shield className="w-7 h-7 text-gray-900" />
            <span className="text-xl font-bold text-gray-900 tracking-tight">VisionGuard</span>
          </Link>
        </div>

        <div className="w-full max-w-[420px] m-auto flex flex-col justify-center">
          
          {/* Header / Tabs - Underline Style */}
          <div className="mb-8">
            <div className="flex space-x-8 border-b border-gray-100 mb-6 relative">
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
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-gray-900"
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
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-gray-900"
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
                <h2 className="text-[22px] font-bold text-gray-900 mb-1 tracking-tight">
                  {mode === 'login' ? 'Welcome Back' : 'Get Started'}
                </h2>
                <p className="text-gray-500 text-[14px]">
                  {mode === 'login' 
                    ? 'Sign in to access your operations dashboard.' 
                    : 'Create a new account to deploy VisionGuard.'}
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
                  <span>{successMsg}</span>
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
                        placeholder="admin@transport.gov"
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
                    className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-all cursor-pointer hover:shadow-md hover:-translate-y-px flex justify-center items-center h-[46px]"
                  >
                    {isLoading ? (
                      <div className="flex items-center justify-center space-x-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        <span className="text-[14px]">Authenticating...</span>
                      </div>
                    ) : (
                      <span className="text-[14px]">Enter Control Room</span>
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
                        placeholder="admin@transport.gov"
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
                    className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-all cursor-pointer hover:shadow-md hover:-translate-y-px mt-2 flex justify-center items-center h-[46px]"
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

          {/* Bottom Trust Text */}
          <div className="mt-8 pt-6">
            <p className="text-[13px] leading-[1.6] text-gray-400 text-center font-medium">
              Built for Transportation Authorities, Traffic Operations Centers, Smart City Programs, and Infrastructure Monitoring Teams.
            </p>
          </div>

        </div>
      </div>
    </motion.div>
  );
}
