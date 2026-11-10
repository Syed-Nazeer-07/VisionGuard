import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/** Consistent understated auth shell for recovery and confirmation pages. */
export function AuthCardLayout({
  title, subtitle, children
}: { title: string; subtitle: string; children: ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-[#f5f7fa] px-4 py-12 text-slate-900">
    <div className="w-full max-w-[430px]">
      <Link to="/" className="mb-8 inline-flex items-center gap-2.5 text-[16px] font-bold tracking-tight text-[#1b2c43]">
        <img src="/brand-mark.svg" alt="" width={36} height={36} className="h-9 w-9 rounded-[10px]" />
        VisionGuard
      </Link>
      <section className="vg-panel p-6 shadow-sm sm:p-8">
        <div className="mb-6">
          <h1 className="text-[23px] font-semibold tracking-[-.035em] text-[#18283d]">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p>
        </div>
        {children}
      </section>
      <Link to="/login" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-[#2356a8]">
        <ArrowLeft size={16}/> Back to sign in
      </Link>
    </div>
  </main>;
}
