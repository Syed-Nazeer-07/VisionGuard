import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ThemeControl } from '../theme/ThemeControl';
import '../../pages/auth/AuthTheme.css';

export function AuthCardLayout({
  title, subtitle, children, signInLink = true
}: { title: string; subtitle: ReactNode; children: ReactNode; signInLink?: boolean }) {
  return <main className="vg-auth">
    <div className="vg-auth-showcase" aria-hidden="true">
      <div className="vg-auth-photo"/>
      <div className="vg-auth-photo-copy">
        <p>Traffic video analysis</p>
        <span>Read the road<br/><em>in motion.</em></span>
      </div>
      <div className="vg-auth-credit">Vancouver, Canada · Ferdinand Stöhr</div>
    </div>
    <div className="vg-auth-form">
      <header className="vg-auth-header">
        <Link to="/" className="vg-auth-brand" aria-label="VisionGuard homepage">
          <img src="/brand-mark.svg?v=20261111" alt="" width="36" height="36"/>VisionGuard
        </Link>
        <ThemeControl/>
      </header>
      <section className="vg-auth-form-inner">
        <div className="vg-auth-title"><h1>{title}</h1><p>{subtitle}</p></div>
        {children}
        {signInLink && <Link to="/login" className="vg-auth-back"><ArrowLeft size={16}/> Back to sign in</Link>}
      </section>
    </div>
  </main>;
}
