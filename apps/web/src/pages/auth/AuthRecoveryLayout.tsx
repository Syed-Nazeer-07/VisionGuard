import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, LockKeyhole, ShieldCheck } from 'lucide-react';

/** Shared authentication recovery shell matching the main VisionGuard sign-in. */
export function AuthRecoveryLayout({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-white flex">
      <section className="hidden lg:flex lg:w-[52%] xl:w-[54%] relative min-h-screen bg-slate-950 text-white overflow-hidden flex-col justify-between p-10 xl:p-16">
        <img src="/signin_hero.jpg" alt="" aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover object-center brightness-[0.6]" />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/85 via-slate-950/60 to-slate-950/95" />
        <Link to="/" className="relative z-10 flex items-center gap-3 w-fit">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 backdrop-blur">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <span className="text-xl font-bold tracking-tight">VisionGuard</span>
        </Link>
        <div className="relative z-10 max-w-lg">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-200 mb-5">
            <Activity className="w-4 h-4" /> Secure operations platform
          </div>
          <h2 className="text-4xl font-semibold tracking-tight leading-tight mb-5">
            Your roadway intelligence workspace. Protected.
          </h2>
          <p className="text-sm text-slate-300 max-w-md leading-relaxed">
            Manage your access securely. Return to analysis, footage review and reporting with a verified account.
          </p>
          <div className="mt-9 inline-flex items-center gap-3 text-xs text-slate-300 border border-white/15 rounded-xl bg-white/5 px-4 py-3">
            <LockKeyhole className="h-4 w-4 text-indigo-300" />
            Password recovery uses an expiring email link.
          </div>
        </div>
        <p className="relative z-10 text-xs text-slate-400">© 2026 VisionGuard · Secure account access</p>
      </section>
      <section className="flex-1 min-w-0 flex flex-col min-h-screen bg-white px-6 sm:px-12 lg:px-16 py-8">
        <div className="flex items-center justify-between w-full lg:justify-end">
          <Link to="/" className="lg:hidden flex items-center gap-2 font-bold text-slate-900">
            <ShieldCheck className="h-6 w-6" /> VisionGuard
          </Link>
          <Link to="/login" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-indigo-700">
            <ArrowLeft className="w-4 h-4" /> Back to sign in
          </Link>
        </div>
        <div className="w-full max-w-[420px] mx-auto my-auto py-12">
          <div className="mb-8">
            <span className="text-xs uppercase font-bold tracking-widest text-indigo-600">{eyebrow}</span>
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-950 tracking-tight mt-3">{title}</h1>
            <p className="text-sm text-slate-500 leading-relaxed mt-3">{description}</p>
          </div>
          {children}
        </div>
        <p className="text-xs text-slate-400 text-center">Having trouble? Contact your organization's account administrator.</p>
      </section>
    </main>
  );
}

export const recoveryInput =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10';
export const recoveryButton =
  'w-full inline-flex justify-center items-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow-sm hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition';
