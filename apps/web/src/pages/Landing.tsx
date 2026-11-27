import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, ChevronRight, LockKeyhole, Menu, ScanLine, X } from 'lucide-react';
import { ThemeControl } from '../components/theme/ThemeControl';
import './Landing.css';

const sections = [
  { id: 'platform', label: 'Product' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'workflow', label: 'Workflow' },
];

const scenes = [
  { label: 'Observe', heading: 'Start with a scene', text: 'Open a recording, connect a camera, or share a browser tab with permission.' },
  { label: 'Follow', heading: 'Follow vehicles across frames', text: 'Vehicle overlays help connect observations over time. Image-derived speed is an estimate.' },
  { label: 'Review', heading: 'Keep the evidence in context', text: 'Revisit saved sessions, compare vehicle classes, and send unusual observations for human review.' },
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
  const [scene, setScene] = useState(0);
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
          <ThemeControl/>
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
            <h1>Read the road<br/> <em>in motion.</em></h1>
            <div>
              <p>Trace how vehicles move through a scene. Review the moments that matter. Work with your own traffic footage, right in the browser.</p>
              <div className="vgn-hero-actions">
                <a href="/register" className="vgn-button vgn-button-accent">Get started <ArrowUpRight size={17}/></a>
                <a href="#platform" className="vgn-text-action">Explore the workspace <ArrowDown size={16}/></a>
              </div>
            </div>
          </div>
        </div>
        <figure className="vgn-hero-demo vgn-shell">
          <picture>
            <source media="(max-width: 680px)" srcSet="/imagery/traffic-night-small.webp"/>
            <img src="/imagery/traffic-night.webp" width="1800" height="1200" fetchPriority="high"
              alt="Traffic and light trails at a downtown Vancouver intersection at night"/>
          </picture>
          <figcaption><span>Vancouver, Canada</span><span>Photograph by Ferdinand Stöhr</span></figcaption>
        </figure>
      </section>

      <section className="vgn-section vgn-shell vgn-reveal" id="platform">
        <div className="vgn-section-heading">
          <h2>From a single scene<br/> to a useful record.</h2>
          <p>VisionGuard brings video, vehicle tracking and session history into one workspace. Explore the steps below, then try the detector on sample footage or your own recording.</p>
        </div>
        <div className="vgn-story">
          <div className="vgn-stage-image" data-scene={scene}>
            <img src="/imagery/motorway-still.webp" alt="Vehicles on the A40 motorway, seen from a bridge" width="960" height="540" loading="lazy"/>
            {scene === 1 && <div className="vgn-trace" aria-hidden="true"><i/><i/><i/></div>}
            <span>Illustrative workflow preview</span>
          </div>
          <div className="vgn-story-copy">
            <div className="vgn-stage-tabs" role="group" aria-label="Explore the VisionGuard analysis workflow">
              {scenes.map((item, index) => <button key={item.label} type="button" className="vgn-stage-tab"
                aria-pressed={scene === index} onClick={() => setScene(index)}>{item.label}</button>)}
            </div>
            <div aria-live="polite"><h3>{scenes[scene].heading}</h3><p>{scenes[scene].text}</p></div>
            <a href="/register" className="vgn-text-action">Open the workspace <ArrowRight size={16}/></a>
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
        <div className="vgn-section-heading"><h2>Start with footage.<br/> Finish with findings.</h2><p>Study traffic patterns, compare recorded scenes and review events that need a closer look.</p></div>
        <ol className="vgn-workflow">
          <li><h3>Choose a source</h3><p>Upload a recording or try the included motorway sample.</p></li>
          <li><h3>Inspect the scene</h3><p>Seek through the recording or slow playback to give the detector more time per second of footage.</p></li>
          <li><h3>Share your findings</h3><p>Review flagged observations and download a summary PDF or detailed records.</p></li>
        </ol>
      </section>

      <section className="vgn-cta">
        <div className="vgn-shell">
          <h2>Bring a road scene<br/> into focus.</h2>
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
