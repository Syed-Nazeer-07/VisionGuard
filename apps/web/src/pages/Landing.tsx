import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowRight, ArrowUpRight, BarChart3, Check, ChevronRight,
  CircleDot, CloudUpload, Cpu, Database, FileText, Film, Fingerprint,
  Layers3, LockKeyhole, Menu, ScanLine, Shield, ShieldCheck, Sparkles,
  X, Zap
} from 'lucide-react';
import './Landing.css';

const highlights = [
  { icon: ScanLine, title: 'Frame-by-frame visibility', detail: 'Vehicle detections and visual tracks in the same playback view.' },
  { icon: BarChart3, title: 'Connected intelligence', detail: 'Session summaries, class breakdowns, and activity history in one place.' },
  { icon: Fingerprint, title: 'Reviewable by design', detail: 'A clear path from AI-assisted observations to human review.' },
  { icon: CloudUpload, title: 'Storage on your terms', detail: 'Keep footage on your device, or opt into cloud storage when configured.' },
];

const workflow = [
  {
    number: '01', icon: Film, title: 'Bring the footage',
    detail: 'Select a local video or approve a browser tab or camera capture. You decide what the app can see.',
  },
  {
    number: '02', icon: ScanLine, title: 'See the activity',
    detail: 'YOLO11s and visual tracking identify road users and follow observed motion across sampled frames.',
  },
  {
    number: '03', icon: FileText, title: 'Turn it into context',
    detail: 'Return to your session history, inspect summaries, review incidents, and export reports.',
  },
];

type PreviewMode = 'detect' | 'track' | 'review';

const previewModes: { id: PreviewMode; name: string; title: string; description: string }[] = [
  { id: 'detect', name: 'Detect', title: 'Spot what matters', description: 'Vehicle classes and bounding boxes in context.' },
  { id: 'track', name: 'Track', title: 'Follow the movement', description: 'Persistent IDs and approximate on-screen motion.' },
  { id: 'review', name: 'Review', title: 'Keep the context', description: 'Move from a session to reviewable information.' },
];

function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className={'vg-brand' + (light ? ' vg-brand--light' : '')} aria-label="VisionGuard home">
      <span className="vg-brand-mark" aria-hidden="true"><Shield size={21} strokeWidth={2} /><span className="vg-brand-mark-dot" /></span>
      <span>Vision<span className="vg-brand-emphasis">Guard</span><span className="vg-brand-period">.</span></span>
    </Link>
  );
}

export function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('detect');
  const selectedPreview = previewModes.find(mode => mode.id === previewMode) ?? previewModes[0];
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="vg-landing">
      <a className="vg-skip-link" href="#main-content">Skip to content</a>

      <header className="vg-landing-header">
        <nav className="vg-landing-nav vg-container" aria-label="Main navigation">
          <Brand />
          <div className="vg-nav-links">
            <a href="#platform">Platform</a>
            <a href="#workflow">How it works</a>
            <a href="#approach">Our approach</a>
          </div>
          <div className="vg-nav-actions">
            <Link className="vg-nav-login" to="/login">Sign in</Link>
            <Link className="vg-button vg-button--small vg-button--accent" to="/register">
              Launch workspace <ArrowUpRight size={16} />
            </Link>
          </div>
          <button
            className="vg-mobile-toggle"
            type="button"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={menuOpen}
            aria-controls="vg-mobile-navigation"
            onClick={() => setMenuOpen(open => !open)}
          >
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </nav>
        {menuOpen && (
          <div id="vg-mobile-navigation" className="vg-mobile-navigation">
            <a href="#platform" onClick={closeMenu}>Platform <ChevronRight size={16} /></a>
            <a href="#workflow" onClick={closeMenu}>How it works <ChevronRight size={16} /></a>
            <a href="#approach" onClick={closeMenu}>Our approach <ChevronRight size={16} /></a>
            <Link to="/login" onClick={closeMenu}>Sign in <ChevronRight size={16} /></Link>
            <Link to="/register" onClick={closeMenu} className="vg-mobile-primary">Launch workspace <ArrowUpRight size={16} /></Link>
          </div>
        )}
      </header>

      <main id="main-content">
        <section className="vg-hero">
          <div className="vg-hero-grid" aria-hidden="true" />
          <div className="vg-hero-glow vg-hero-glow--left" aria-hidden="true" />
          <div className="vg-hero-glow vg-hero-glow--right" aria-hidden="true" />
          <div className="vg-container vg-hero-layout">
            <div className="vg-hero-copy">
              <div className="vg-eyebrow vg-hero-eyebrow"><span className="vg-live-dot" /> MEET YOUR TRAFFIC INTELLIGENCE WORKSPACE <ArrowUpRight size={13} /></div>
              <h1>See the road.<br /><span>Understand<br className="vg-desktop-break" /> the motion.</span></h1>
              <p className="vg-hero-description">
                From moving footage to meaningful context. Detect road users, follow visual tracks, and bring analysis, history, and review into one connected workspace.
              </p>
              <div className="vg-hero-actions">
                <Link to="/register" className="vg-button vg-button--accent vg-button--hero">
                  Get started <ArrowUpRight size={18} />
                </Link>
                <a href="#platform" className="vg-button vg-button--outline vg-button--hero">
                  Explore the platform <ArrowRight size={17} />
                </a>
              </div>
              <div className="vg-hero-footnote">
                <span className="vg-footnote-icon"><Check size={13} /></span>
                Browser-based analysis <span className="vg-footnote-separator" />
                Your footage stays local unless you choose otherwise
              </div>
            </div>

            <div className="vg-hero-visual">
              <div className="vg-monitor-halo" aria-hidden="true" />
              <div className="vg-visual-corner vg-visual-corner--top" aria-hidden="true">V/G · 001</div>
              <div className="vg-monitor">
                <div className="vg-monitor-toolbar">
                  <div className="vg-monitor-ident"><span className="vg-monitor-led" /><span>VISIONGUARD</span><span className="vg-monitor-slash">/</span><span className="vg-monitor-strong">ANALYSIS PREVIEW</span></div>
                  <div className="vg-monitor-indicator"><CircleDot size={12} /> PRODUCT CONCEPT</div>
                </div>
                <div className={'vg-monitor-scene vg-monitor-scene--' + previewMode}>
                  <img src="/traffic_monitoring_corridor.jpg" alt="Illustrative aerial view of traffic on a road" loading="eager" fetchPriority="high" />
                  <div className="vg-monitor-image-shade" aria-hidden="true" />
                  {previewMode !== 'review' && (
                    <div className="vg-sample-tracks" aria-hidden="true">
                      <div className="vg-sample-track vg-sample-track--one">
                        <span className="vg-track-corner vg-track-corner--tl" /><span className="vg-track-corner vg-track-corner--tr" />
                        <span className="vg-track-corner vg-track-corner--bl" /><span className="vg-track-corner vg-track-corner--br" />
                        <span className="vg-track-caption">#08 · CAR</span>
                      </div>
                      <div className="vg-sample-track vg-sample-track--two">
                        <span className="vg-track-corner vg-track-corner--tl" /><span className="vg-track-corner vg-track-corner--tr" />
                        <span className="vg-track-corner vg-track-corner--bl" /><span className="vg-track-corner vg-track-corner--br" />
                        <span className="vg-track-caption">#12 · TRUCK</span>
                      </div>
                      {previewMode === 'track' && <div className="vg-track-route"><span /><span /><span /><span /></div>}
                    </div>
                  )}
                  {previewMode === 'review' && (
                    <div className="vg-review-surface" aria-hidden="true">
                      <div className="vg-review-top"><FileText size={19} /><span>SESSION REVIEW</span></div>
                      <div className="vg-review-row"><span className="vg-review-symbol"><Check size={13} /></span> Video activity captured <span>01</span></div>
                      <div className="vg-review-row"><span className="vg-review-symbol"><Check size={13} /></span> Tracks and classes <span>02</span></div>
                      <div className="vg-review-row"><span className="vg-review-symbol"><Check size={13} /></span> Reviewable timeline <span>03</span></div>
                    </div>
                  )}
                  <div className="vg-monitor-scan" aria-hidden="true" />
                  <div className="vg-monitor-top-info"><span><span className="vg-blink-dot" /> VISUAL INTELLIGENCE</span><span>DEMONSTRATION</span></div>
                  <div className="vg-monitor-bottom-info"><ScanLine size={13} /><span>ILLUSTRATIVE TRACKING OVERLAY — NOT LIVE DETECTIONS</span></div>
                </div>
                <div className="vg-monitor-console">
                  <div className="vg-monitor-tabs" role="tablist" aria-label="Preview product workflow">
                    {previewModes.map(mode => (
                      <button
                        key={mode.id}
                        id={'vg-preview-tab-' + mode.id}
                        type="button"
                        role="tab"
                        aria-controls="vg-preview-panel"
                        aria-selected={previewMode === mode.id}
                        className={'vg-monitor-tab' + (previewMode === mode.id ? ' vg-monitor-tab--active' : '')}
                        onClick={() => setPreviewMode(mode.id)}
                      >
                        {mode.name}
                      </button>
                    ))}
                  </div>
                  <div id="vg-preview-panel" role="tabpanel" aria-labelledby={'vg-preview-tab-' + previewMode} className="vg-monitor-summary">
                    <span className="vg-monitor-summary-icon"><Activity size={16} /></span>
                    <div><strong>{selectedPreview.title}</strong><p>{selectedPreview.description}</p></div>
                    <ArrowUpRight size={17} className="vg-monitor-summary-arrow" />
                  </div>
                </div>
              </div>
              <div className="vg-orbit-card vg-orbit-card--top"><span className="vg-orbit-icon"><Zap size={16} /></span><span>YOLO11s <small>INFERENCE ENGINE</small></span></div>
              <div className="vg-orbit-card vg-orbit-card--bottom"><span className="vg-orbit-pulse"><Activity size={17} /></span><span>From pixels <small>TO REVIEWABLE INSIGHTS</small></span></div>
              <div className="vg-visual-corner vg-visual-corner--bottom" aria-hidden="true">INTELLIGENCE // VISUALIZED</div>
            </div>
          </div>
          <div className="vg-container vg-hero-footer">
            <span>BUILT AROUND YOUR WORKFLOW</span>
            <div><span><Cpu size={15} /> YOLO11s + ONNX</span><span><Layers3 size={15} /> WebGPU / WASM</span><span><ShieldCheck size={15} /> Review-first</span><span><Database size={15} /> Session history</span></div>
          </div>
        </section>

        <section id="platform" className="vg-section vg-platform">
          <div className="vg-container">
            <div className="vg-section-heading">
              <div><p className="vg-kicker"><span>01 / PLATFORM</span> <span className="vg-kicker-line" /></p><h2>A clearer view.<br /><span>At every step.</span></h2></div>
              <p>One place to move from raw footage to something you can actually understand, revisit, and act on responsibly.</p>
            </div>
            <div className="vg-bento">
              <article className="vg-bento-card vg-bento-card--wide">
                <div className="vg-bento-card-copy">
                  <span className="vg-card-index">01 / UNIFIED WORKSPACE</span>
                  <h3>Everything connects.<br />Nothing gets lost.</h3>
                  <p>Your footage, vehicle tracks, session history, analytics, and incident review belong to the same experience.</p>
                  <Link to="/register" className="vg-text-link">Explore your workspace <ArrowUpRight size={16} /></Link>
                </div>
                <div className="vg-bento-preview">
                  <div className="vg-bento-preview-top"><span className="vg-bento-preview-dot" /> ANALYSIS DASHBOARD <span className="vg-bento-preview-top-right">CONCEPT VIEW</span></div>
                  <img src="/platform_preview.png" alt="Preview image of the VisionGuard application interface" loading="lazy" />
                  <span className="vg-bento-preview-glow" aria-hidden="true" />
                </div>
              </article>
              <article className="vg-bento-card vg-bento-card--compute">
                <div className="vg-compute-orbit" aria-hidden="true"><span className="vg-compute-ring vg-compute-ring--one" /><span className="vg-compute-ring vg-compute-ring--two" /><span className="vg-compute-ring vg-compute-ring--three" /><span className="vg-compute-center"><ScanLine size={33} /></span></div>
                <span className="vg-card-index">02 / BROWSER-FIRST</span>
                <h3>Intelligence close<br />to the source.</h3>
                <p>Run supported analysis directly in your browser, with WebGPU acceleration where available and a WebAssembly fallback.</p>
              </article>
              <article className="vg-bento-card vg-bento-card--history">
                <div className="vg-history-art" aria-hidden="true">
                  <div><span className="vg-history-rail-dot" /> <span className="vg-history-item-line vg-history-item-line--long" /></div>
                  <div><span className="vg-history-rail-dot" /> <span className="vg-history-item-line" /></div>
                  <div><span className="vg-history-rail-dot vg-history-rail-dot--active" /> <span className="vg-history-item-line vg-history-item-line--medium" /></div>
                  <span className="vg-history-caption">ACTIVITY / TIMELINE</span>
                </div>
                <span className="vg-card-index">03 / CONNECTED RECORDS</span>
                <h3>Work worth<br />coming back to.</h3>
                <p>Review session summaries, class counts, and activity records without starting from scratch.</p>
              </article>
            </div>
            <div className="vg-feature-grid">
              {highlights.map(({ icon: Icon, title, detail }) => (
                <article className="vg-feature" key={title}>
                  <div className="vg-feature-icon"><Icon size={21} strokeWidth={1.8} /></div>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                  <span className="vg-feature-asterisk"><ArrowUpRight size={15} /></span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="workflow" className="vg-section vg-workflow">
          <div className="vg-container">
            <div className="vg-section-heading vg-section-heading--workflow">
              <div><p className="vg-kicker"><span>02 / HOW IT WORKS</span> <span className="vg-kicker-line" /></p><h2>From footage<br /><span>to foresight.</span></h2></div>
              <p>Powerful underneath. Surprisingly straightforward on the surface.</p>
            </div>
            <div className="vg-workflow-steps">
              {workflow.map(({ number, icon: Icon, title, detail }, index) => (
                <article className="vg-workflow-step" key={number}>
                  <div className="vg-step-number"><span>{number}</span>{index < workflow.length - 1 && <span className="vg-step-connector" aria-hidden="true" />}</div>
                  <div className="vg-step-icon"><Icon size={24} strokeWidth={1.6} /></div>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="approach" className="vg-section vg-approach">
          <div className="vg-container vg-approach-grid">
            <div className="vg-approach-intro">
              <p className="vg-kicker"><span>03 / THE PHILOSOPHY</span> <span className="vg-kicker-line" /></p>
              <h2>Powerful vision.<br /><span>Grounded claims.</span></h2>
              <p>Good intelligence doesn't just look impressive. It makes its limitations clear and gives people control over what happens next.</p>
              <Link className="vg-text-link" to="/register">Experience VisionGuard <ArrowUpRight size={16} /></Link>
              <div className="vg-approach-image"><img src="/traffic_flow_analysis.jpg" loading="lazy" alt="A road traffic scene viewed from above" /></div>
            </div>
            <div className="vg-approach-list">
              <div className="vg-approach-row"><span className="vg-approach-number">01</span><span className="vg-approach-icon"><Cpu size={23} /></span><div><h3>Built for the browser</h3><p>YOLO11s detection and frame-to-frame visual tracking, without making a cloud video upload mandatory.</p></div></div>
              <div className="vg-approach-row"><span className="vg-approach-number">02</span><span className="vg-approach-icon"><LockKeyhole size={23} /></span><div><h3>Clear storage choices</h3><p>Local video retention is opt-in. Cloud originals require explicit upload and configured Backblaze B2 storage.</p></div></div>
              <div className="vg-approach-row"><span className="vg-approach-number">03</span><span className="vg-approach-icon"><Activity size={23} /></span><div><h3>Measurements with context</h3><p>Image-derived motion and speed proxies are approximate—not calibrated road-speed evidence.</p></div></div>
              <div className="vg-approach-row"><span className="vg-approach-number">04</span><span className="vg-approach-icon"><ShieldCheck size={23} /></span><div><h3>Human review stays central</h3><p>Automated observations should support review, not replace verification or legal judgement.</p></div></div>
            </div>
          </div>
        </section>

        <section className="vg-final-cta">
          <div className="vg-container vg-final-inner">
            <div className="vg-final-grid" aria-hidden="true" />
            <div className="vg-final-eyebrow"><Sparkles size={14} /> THE NEXT FRAME IS YOURS</div>
            <h2>See more.<br /><span>Understand better.</span></h2>
            <p>Bring your own footage into a connected traffic intelligence workspace, built for clarity from first frame to final review.</p>
            <div className="vg-final-actions"><Link className="vg-button vg-button--accent vg-button--hero" to="/register">Start with VisionGuard <ArrowUpRight size={18} /></Link><Link className="vg-final-login" to="/login">Already have an account? Sign in <ArrowRight size={16} /></Link></div>
            <span className="vg-final-decoration" aria-hidden="true"><ScanLine size={160} strokeWidth={0.5} /></span>
          </div>
        </section>
      </main>

      <footer className="vg-landing-footer">
        <div className="vg-container vg-footer-top">
          <div><Brand light /><p>Clarity in every frame.<br />Context behind every decision.</p></div>
          <div className="vg-footer-links"><a href="#platform">Platform</a><a href="#workflow">Workflow</a><a href="#approach">Our approach</a><Link to="/login">Sign in</Link></div>
        </div>
        <div className="vg-container vg-footer-bottom"><span>© {new Date().getFullYear()} VisionGuard. Built for responsible traffic intelligence.</span><span><Shield size={14} /> Analysis is assistive. Review remains essential.</span></div>
      </footer>
    </div>
  );
}
