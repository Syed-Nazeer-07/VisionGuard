import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import '../../pages/auth/AuthTheme.css';

/** Shared recovery shell with the same visual language as sign-in and registration. */
export function AuthCardLayout({
  title, subtitle, children
}: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="vg-auth-recovery flex min-h-screen items-center justify-center px-5 py-12 text-[#263136]">
      <div className="w-full max-w-[456px]">
        <Link to="/" className="vg-auth-recovery-brand mb-9 inline-flex items-center gap-2.5 text-[19px] font-bold tracking-[-.045em] text-[#263136]">
          <img src="/brand-mark.svg?v=20261111" alt="" width={38} height={38} className="h-[38px] w-[38px] rounded-[10px]" />
          VisionGuard
        </Link>
        <section className="vg-auth-recovery-card rounded-2xl border border-[#dce3e1] bg-white p-6 sm:p-9">
          <div className="mb-7">
            <span className="vg-auth-recovery-kicker">ACCOUNT SECURITY / VISIONGUARD</span>
            <h1 className="mt-4 text-[28px] font-semibold tracking-[-.055em] text-[#263136]">{title}</h1>
            <p className="mt-2 text-sm leading-7 text-[#69777d]">{subtitle}</p>
          </div>
          {children}
        </section>
        <Link to="/login" className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-[#596970] hover:text-[#202b30]">
          <ArrowLeft size={16} /> Back to sign in
        </Link>
      </div>
    </main>
  );
}
