import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, ChevronRight, LockKeyhole, Menu, ScanLine, X } from 'lucide-react';
import { ThemeControl } from '../components/theme/ThemeControl';
import './Landing.css';

const sections = [
  { id: 'platform', label: 'Product' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'workflow', label: 'Workflow' },
];

function Brand() {
  return <a href="/" className="vgn-brand" aria-label="VisionGuard homepage">
    <img src="/brand-mark.svg?v=20261111" alt="" width="34" height="34"/>
    <span>VisionGuard</span>
  </a>;
}

export function Landing() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const marker = (headerRef.current?.getBoundingClientRect().height ?? 68) + 64;
      const reached = sections.filter(item => (document.getElementById(item.id)?.getBoundingClientRect().top ?? Infinity) <= marker);
      setActive(reached.at(-1)?.id ?? '');
      setScrolled(window.scrollY > 12);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMobileOpen(false);
      menuRef.current?.focus();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [mobileOpen]);

  useEffect(() => {
    if (!('IntersectionObserver' in window) || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('vgn-revealed');
      observer.unobserve(entry.target);
    }), { threshold: .13 });
    document.querySelectorAll('.vgn-reveal').forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const sectionLinks = sections.map(({ id, label }) => <a key={id} href={'#' + id}
    aria-current={active === id ? 'location' : undefined} onClick={() => setMobileOpen(false)}>{label}</a>);

  return <div className="vgn">
    <a href="#main" className="vgn-skip">Skip to content</a>
    <header ref={headerRef} className="vgn-header" data-scrolled={scrolled}>
      <nav className="vgn-shell vgn-nav" aria-label="Primary navigation">
        <Brand/>
        <div className="vgn-nav-links">{sectionLinks}</div>
        <div className="vgn-nav-tools">
          <ThemeControl expanded/>
          <div className="vgn-nav-actions">
            <a className="vgn-sign-in" href="/login">Sign in</a>
            <a className="vgn-button vgn-button-accent" href="/register">Get started <ArrowUpRight size={16}/></a>
          </div>
          <button type="button" ref={menuRef} className="vgn-menu-button" aria-expanded={mobileOpen}
            aria-controls="vgn-mobile-navigation" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
            onClick={() => setMobileOpen(value => !value)}>{mobileOpen ? <X size={21}/> : <Menu size={21}/>}</button>
        </div>
      </nav>
      {mobileOpen && <nav className="vgn-mobile-navigation" id="vgn-mobile-navigation" aria-label="Mobile navigation">
        {sectionLinks}
        <a href="/login">Sign in <ChevronRight size={16}/></a>
        <a href="/register">Get started <ArrowUpRight size={16}/></a>
      </nav>}
    </header>

    <main id="main">
      <section className="vgn-hero">
        <div className="vgn-shell vgn-hero-content">
          <p className="vgn-kicker"><span/> Traffic video analysis</p>
          <div className="vgn-hero-grid">
            <h1>Understand traffic.<br/> <em>Frame by frame.</em></h1>
            <div>
              <p>Detect and track vehicles in traffic footage, then review and export your findings. All from your browser.</p>
              <div className="vgn-hero-actions">
                <a href="/register" className="vgn-button vgn-button-accent">Get started <ArrowUpRight size={17}/></a>
                <a href="#platform" className="vgn-text-action">Explore the workspace <ArrowDown size={16}/></a>
              </div>
            </div>
          </div>
        </div>
        <figure className="vgn-hero-demo vgn-shell">
          <img src="/signin_hero.jpg" fetchPriority="high" decoding="async"
            alt="Traffic camera overlooking a multilane highway"/>
          <figcaption><span>Traffic monitoring</span><span>Illustrative scene</span></figcaption>
        </figure>
      </section>

      <section className="vgn-section vgn-shell vgn-reveal" id="platform">
        <div className="vgn-product-heading">
          <div><p className="vgn-kicker">The detector</p><h2>See beyond the footage.</h2></div>
          <a href="/register" className="vgn-text-action">Open the workspace <ArrowRight size={16}/></a>
        </div>
        <div className="vgn-product-showcase">
          <div className="vgn-preview-bar"><span><ScanLine size={16}/> Vehicle tracking</span><span>Recorded sample</span></div>
          <figure className="vgn-stage-image">
            <img src="/imagery/motorway-detections.webp" alt="VisionGuard detector output with tracking boxes around vehicles on the A40 motorway" width="960" height="540" loading="lazy"/>
            <figcaption>Frame from a sample analysis</figcaption>
          </figure>
          <div className="vgn-feature-strip">
            <div><span className="vgn-feature-index">01</span><h3>Detect</h3><p>Identify vehicles in recorded footage.</p></div>
            <div><span className="vgn-feature-index">02</span><h3>Track</h3><p>Follow movement across frames.</p></div>
            <div><span className="vgn-feature-index">03</span><h3>Review</h3><p>Revisit sessions and export findings.</p></div>
          </div>
        </div>
      </section>

      <section className="vgn-capabilities vgn-section vgn-reveal" id="capabilities">
        <div className="vgn-shell vgn-capability-grid">
          <div><ScanLine size={28}/><h2>See what moved.</h2><p>Use vehicle classes and tracks to compare approaches at an intersection or review movement along a highway. Save session summaries and export observations for further analysis.</p></div>
          <div><LockKeyhole size={27}/><h2>Keep control of footage.</h2><p>Detection runs in your browser. Saving an original on this device is optional. Cloud video backup requires explicit upload.</p></div>
        </div>
      </section>

      <section className="vgn-section vgn-shell vgn-reveal" id="workflow">
        <div className="vgn-section-heading"><h2>Your analysis workflow.</h2><p>Study traffic patterns, compare recorded scenes and review events that need a closer look.</p></div>
        <ol className="vgn-workflow">
          <li><h3>Choose a source</h3><p>Upload a recording or try the included motorway sample.</p></li>
          <li><h3>Inspect the scene</h3><p>Seek through the recording or slow playback to give the detector more time per second of footage.</p></li>
          <li><h3>Share your findings</h3><p>Review flagged observations and download a summary PDF or detailed records.</p></li>
        </ol>
      </section>

      <section className="vgn-cta">
        <div className="vgn-shell">
          <h2>Ready to analyze?</h2>
          <div className="vgn-cta-actions">
            <a href="/register" className="vgn-button vgn-button-accent">Get started <ArrowUpRight size={17}/></a>
            <a href="/login" className="vgn-text-action">Sign in <ArrowRight size={16}/></a>
          </div>
        </div>
      </section>
    </main>
    <footer className="vgn-footer vgn-shell">
      <Brand/>
      <a href="https://commons.wikimedia.org/wiki/File:Motorway_A40_-_on_bridge_above_the_traffic.webm">Motorway footage by Kathinka Engels · CC BY 4.0</a>
    </footer>
  </div>;
}
