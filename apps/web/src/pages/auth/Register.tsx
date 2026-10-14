import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/auth';
import { cn } from '../../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shield, 
  Eye, 
  EyeOff, 
  Mail, 
  Lock, 
  User, 
  Building, 
  AlertTriangle, 
  CheckCircle2, 
  Layers, 
  Activity, 
  Camera 
} from 'lucide-react';

const registerSchema = z.object({
  fullName: z.string().min(2, 'Full name is required'),
  organization: z.string().min(2, 'Organization is required'),
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
  role: z.enum(['Viewer', 'Operator', 'Supervisor', 'Admin']),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type RegisterForm = z.infer<typeof registerSchema>;

export function Register() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: 'Viewer' }
  });

  const onSubmit = async (data: RegisterForm) => {
    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    const isMock = !import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL.includes('placeholder');
    if (isMock) {
      setTimeout(() => {
        setIsLoading(false);
        setSuccessMsg('Account created successfully! Redirecting to sign in...');
        setTimeout(() => {
          navigate('/login', { replace: true });
        }, 1200);
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
            role: data.role || 'Viewer'
          }
        }
      });

      setIsLoading(false);

      if (error) {
        setError(error.message);
      } else {
        setSuccessMsg('Registration successful! Please sign in with your credentials.');
        setTimeout(() => {
          navigate('/login', { replace: true });
        }, 1800);
      }
    } catch (err: any) {
      setIsLoading(false);
      setError(err?.message || 'Registration failed');
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen flex bg-white"
    >
      {/* Left Panel - Registration Form (Prominent & Focused) */}
      <div className="w-full lg:w-[48%] xl:w-[46%] flex flex-col items-center justify-center p-6 sm:p-10 lg:p-12 bg-white relative h-screen overflow-y-auto">
        
        {/* Brand Header */}
        <div className="w-full max-w-[440px] mb-6">
          <Link to="/" className="inline-flex items-center space-x-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900 tracking-tight">VisionGuard</span>
          </Link>
        </div>

        <div className="w-full max-w-[440px] my-auto">
          {/* Header & Tabs */}
          <div className="mb-6">
            <div className="flex space-x-8 border-b border-gray-100 mb-5 relative">
              <Link
                to="/login"
                className="pb-3 text-[15px] font-medium text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
              >
                Sign In
              </Link>
              
              <div className="pb-3 text-[15px] font-semibold text-gray-900 relative">
                Create Account
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gray-900" />
              </div>
            </div>

            <div>
              <h2 className="text-[22px] font-bold text-gray-900 mb-1 tracking-tight">
                Get Started with VisionGuard
              </h2>
              <p className="text-gray-500 text-[14px]">
                Create an account to deploy intelligent traffic monitoring.
              </p>
            </div>
          </div>

          {/* Feedback Alerts */}
          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="overflow-hidden"
              >
                <div className="p-3 bg-red-50 border border-red-100 text-red-600 rounded-lg text-[13px] font-medium flex items-start shadow-sm">
                  <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              </motion.div>
            )}
            {successMsg && (
              <motion.div 
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 16 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="overflow-hidden"
              >
                <div className="p-3 bg-green-50 border border-green-100 text-green-700 rounded-lg text-[13px] font-medium flex items-start shadow-sm">
                  <CheckCircle2 className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                  <span>{successMsg}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Registration Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1 uppercase tracking-wide">Full Name</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-4 w-4 text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                  </div>
                  <input
                    type="text"
                    placeholder="Sarah Jenkins"
                    {...register('fullName')}
                    className={cn(
                      "w-full pl-9 pr-3 py-2.5 bg-white border rounded-lg outline-none transition-all text-[13px] text-gray-900 placeholder:text-gray-400 shadow-sm",
                      errors.fullName ? "border-red-300 focus:border-red-500" : "border-gray-200 focus:border-gray-900 hover:border-gray-300"
                    )}
                  />
                </div>
                {errors.fullName && <p className="mt-1 text-[12px] text-red-500 font-medium">{errors.fullName.message}</p>}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1 uppercase tracking-wide">Organization</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Building className="h-4 w-4 text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                  </div>
                  <input
                    type="text"
                    placeholder="Dept. of Transportation"
                    {...register('organization')}
                    className={cn(
                      "w-full pl-9 pr-3 py-2.5 bg-white border rounded-lg outline-none transition-all text-[13px] text-gray-900 placeholder:text-gray-400 shadow-sm",
                      errors.organization ? "border-red-300 focus:border-red-500" : "border-gray-200 focus:border-gray-900 hover:border-gray-300"
                    )}
                  />
                </div>
                {errors.organization && <p className="mt-1 text-[12px] text-red-500 font-medium">{errors.organization.message}</p>}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1 uppercase tracking-wide">Work Email</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-4 w-4 text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                </div>
                <input
                  type="email"
                  placeholder="operator@transport.gov"
                  {...register('email')}
                  className={cn(
                    "w-full pl-9 pr-3 py-2.5 bg-white border rounded-lg outline-none transition-all text-[13px] text-gray-900 placeholder:text-gray-400 shadow-sm",
                    errors.email ? "border-red-300 focus:border-red-500" : "border-gray-200 focus:border-gray-900 hover:border-gray-300"
                  )}
                />
              </div>
              {errors.email && <p className="mt-1 text-[12px] text-red-500 font-medium">{errors.email.message}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1 uppercase tracking-wide">Password</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    {...register('password')}
                    className={cn(
                      "w-full pl-9 pr-9 py-2.5 bg-white border rounded-lg outline-none transition-all text-[13px] text-gray-900 placeholder:text-gray-400 shadow-sm",
                      errors.password ? "border-red-300 focus:border-red-500" : "border-gray-200 focus:border-gray-900 hover:border-gray-300"
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 outline-none p-1"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {errors.password && <p className="mt-1 text-[12px] text-red-500 font-medium">{errors.password.message}</p>}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1 uppercase tracking-wide">Confirm</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-gray-400 group-focus-within:text-gray-900 transition-colors" />
                  </div>
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="••••••••"
                    {...register('confirmPassword')}
                    className={cn(
                      "w-full pl-9 pr-9 py-2.5 bg-white border rounded-lg outline-none transition-all text-[13px] text-gray-900 placeholder:text-gray-400 shadow-sm",
                      errors.confirmPassword ? "border-red-300 focus:border-red-500" : "border-gray-200 focus:border-gray-900 hover:border-gray-300"
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 outline-none p-1"
                  >
                    {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {errors.confirmPassword && <p className="mt-1 text-[12px] text-red-500 font-medium">{errors.confirmPassword.message}</p>}
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 px-4 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-400 text-white rounded-lg font-semibold transition-all cursor-pointer hover:shadow-md hover:-translate-y-px flex justify-center items-center h-[44px]"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span className="text-[13px]">Creating Account...</span>
                  </div>
                ) : (
                  <span className="text-[13px]">Create Account</span>
                )}
              </button>
            </div>
          </form>

          {/* Trust and Sign In link */}
          <div className="mt-6 pt-5 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
            <span>Already registered? <Link to="/login" className="font-semibold text-gray-900 hover:underline">Sign In</Link></span>
            <span>Secure 256-bit TLS</span>
          </div>
        </div>
      </div>

      {/* Right Panel - Aerial Traffic Network Showcase (Distinct from Sign In!) */}
      <div className="hidden lg:flex lg:w-[52%] xl:w-[54%] relative bg-slate-950 flex-col justify-between p-12 xl:p-16 border-l border-slate-800 overflow-hidden text-white select-none">
        {/* Photorealistic Aerial Urban Intersection Background */}
        <div className="absolute inset-0 z-0">
          <img 
            src="/signup_hero.jpg" 
            alt="VisionGuard Urban Intersection Network" 
            className="w-full h-full object-cover object-center filter brightness-[0.72] contrast-[1.12]"
          />
          {/* Subtle dark gradient scrim matching navy/indigo palette */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-slate-950/80" />
          <div className="absolute inset-0 bg-gradient-to-l from-slate-950/80 via-transparent to-slate-950/60" />
        </div>

        {/* Top Network Badge */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700/60 text-xs font-mono text-indigo-300">
            <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
            <span>URBAN GRID TELEMETRY</span>
          </div>
          <span className="text-xs font-mono text-slate-400">JUNCTION J-14 · ACTIVE</span>
        </div>

        {/* Center Content */}
        <div className="relative z-10 my-auto py-8">
          <div className="max-w-[490px]">
            <div className="inline-block px-2.5 py-1 mb-4 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold tracking-wider uppercase font-mono">
              City-Scale Infrastructure
            </div>
            <h1 className="text-3xl xl:text-4xl font-bold text-white leading-tight mb-4 tracking-tight">
              Deploy Intelligent Traffic Intelligence Across Municipal Corridors
            </h1>
            <p className="text-[15px] text-slate-300 leading-relaxed mb-8">
              Join transportation authorities, regional traffic centers, and infrastructure operators using VisionGuard to turn roadway video into actionable operational insight.
            </p>
          </div>

          {/* Three Feature Pillars */}
          <div className="space-y-3 max-w-[490px]">
            <div className="p-3.5 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-800/80 flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-300 flex items-center justify-center flex-shrink-0 mt-0.5 border border-indigo-500/30">
                <Camera className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Multi-Approach Intersection Analysis</h4>
                <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">Simultaneous tracking of vehicles, bicycles, and pedestrians across complex junctions.</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-800/80 flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center flex-shrink-0 mt-0.5 border border-emerald-500/30">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Real-Time Flow & Velocity Telemetry</h4>
                <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">Instant homography-based vehicle speed calculation in km/h with zero cloud latency.</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-800/80 flex items-start gap-3.5">
              <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-300 flex items-center justify-center flex-shrink-0 mt-0.5 border border-sky-500/30">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Role-Based Operations Management</h4>
                <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">Built-in permission tiers for Viewers, Operators, Supervisors, and Administrators.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Metadata */}
        <div className="relative z-10 flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/60 pt-4">
          <span>VisionGuard Traffic Intelligence</span>
          <span>Municipal Edition 2026</span>
        </div>
      </div>
    </motion.div>
  );
}
