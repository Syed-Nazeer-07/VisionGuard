import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, ChevronRight, FileText, Film, History, LockKeyhole, Menu, Monitor, ScanLine, ShieldCheck, Video, X } from 'lucide-react';
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
          <div className="vgn-preview-bar"><span><ScanLine size={16}/> Vehicle tracking</span><span>Traffic analysis</span></div>
          <figure className="vgn-stage-image">
            <img src="/traffic_flow_analysis.jpg" alt="Elevated view of multilane urban highway traffic with cars, trucks and buses" loading="lazy" decoding="async"/>
            <figcaption>Illustrative traffic scene</figcaption>
          </figure>
          <div className="vgn-feature-strip">
            <div><span className="vgn-feature-index">01</span><h3>Detect</h3><p>Identify vehicles in recorded footage.</p></div>
            <div><span className="vgn-feature-index">02</span><h3>Track</h3><p>Follow movement across frames.</p></div>
            <div><span className="vgn-feature-index">03</span><h3>Review</h3><p>Revisit sessions and export findings.</p></div>
          </div>
        </div>
      </section>

      <section className="vgn-capabilities vgn-section vgn-reveal" id="capabilities">
        <div className="vgn-shell">
          <div className="vgn-section-heading vgn-source-heading">
            <div><p className="vgn-kicker">Flexible input</p><h2>Start with any scene.</h2></div>
            <p>Choose the footage you want to inspect. One workspace for recordings and live sources.</p>
          </div>
          <div className="vgn-source-grid">
            <article><Film size={28} strokeWidth={1.5}/><div><h3>Recorded video</h3><p>Open a local recording and inspect traffic at your own pace.</p></div></article>
            <article><Video size={28} strokeWidth={1.5}/><div><h3>Live camera</h3><p>Connect a supported camera with your browser's permission.</p></div></article>
            <article><Monitor size={28} strokeWidth={1.5}/><div><h3>Browser tab</h3><p>Share a browser tab to analyze the video playing there.</p></div></article>
          </div>
        </div>
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

      <section className="vgn-records vgn-section vgn-reveal" id="records">
        <div className="vgn-shell">
          <div className="vgn-section-heading">
            <div><p className="vgn-kicker">Beyond detection</p><h2>Turn footage into findings.</h2></div>
            <p>The recording is only the beginning. Return to your sessions, inspect observations and keep your findings organized.</p>
          </div>
          <div className="vgn-record-grid">
            <article><History size={30} strokeWidth={1.5}/><h3>Session history</h3><p>Revisit saved analyses, vehicle classes and observed tracks.</p><span>History &amp; analytics</span></article>
            <article><ShieldCheck size={30} strokeWidth={1.5}/><h3>Human review</h3><p>Inspect flagged observations, then review, dismiss or reopen them.</p><span>Incident review</span></article>
            <article><FileText size={30} strokeWidth={1.5}/><h3>Export findings</h3><p>Download session summaries as PDF or CSV and review records as CSV.</p><span>Reports</span></article>
          </div>
        </div>
      </section>

      <section className="vgn-section vgn-shell vgn-reveal vgn-engine" id="technology">
        <div className="vgn-engine-copy">
          <p className="vgn-kicker">Browser-first architecture</p>
          <h2>Intelligence, closer to the source.</h2>
          <p>VisionGuard uses YOLO11s and browser-based tracking to analyze traffic footage. Original recordings are not automatically uploaded for detection.</p>
          <a href="/register" className="vgn-text-action">Explore the workspace <ArrowRight size={16}/></a>
        </div>
        <div className="vgn-engine-diagram" aria-label="How browser analysis works">
          <div><span>01</span><Film size={24} strokeWidth={1.5}/><strong>Video input</strong><small>Recording or authorized capture</small></div>
          <ArrowDown size={19} aria-hidden="true"/>
          <div><span>02</span><ScanLine size={24} strokeWidth={1.5}/><strong>Browser inference</strong><small>YOLO11s and vehicle tracking</small></div>
          <ArrowDown size={19} aria-hidden="true"/>
          <div><span>03</span><FileText size={24} strokeWidth={1.5}/><strong>Session records</strong><small>Review, analytics and exports</small></div>
        </div>
      </section>

      <section className="vgn-faq vgn-section vgn-reveal" id="answers">
        <div className="vgn-shell vgn-faq-layout">
          <div><p className="vgn-kicker">Good to know</p><h2>Frequently asked questions.</h2></div>
          <div className="vgn-faq-items">
            <details><summary>Do I need to install anything?<ChevronRight size={19}/></summary><p>VisionGuard runs in a supported browser. A modern Chromium-based browser such as Chrome or Edge is recommended.</p></details>
            <details><summary>Can I use my own footage?<ChevronRight size={19}/></summary><p>Yes. Open a local video, use a supported camera or share an authorized browser tab. Included sample footage is also available.</p></details>
            <details><summary>Does VisionGuard upload my video?<ChevronRight size={19}/></summary><p>Detection happens in your browser. Original-video retention on your device is optional, and cloud backup requires an explicit upload.</p></details>
            <details><summary>Are the speed estimates exact?<ChevronRight size={19}/></summary><p>No. They are uncalibrated optical estimates, not verified road speeds. Review flags require human judgment and are not proof of an offence.</p></details>
          </div>
        </div>
      </section>

      <section className="vgn-cta">
        <div className="vgn-shell">
          <div><p className="vgn-kicker">Your next scene</p><h2>Ready to analyze?</h2><p className="vgn-cta-copy">Try the included footage or bring a recording of your own.</p></div>
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
