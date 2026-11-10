import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowRight, ArrowUpRight, BarChart3, Check, CheckCircle2,
  ChevronRight, CloudUpload, Database, FileText, Film, Layers3,
  LockKeyhole, Menu, ScanLine, Shield, ShieldCheck, Sparkles, X
} from 'lucide-react';
import './Landing.css';

type Preview = 'detect' | 'track' | 'review';

const previews: { id: Preview; label: string; title: string; description: string }[] = [
  { id: 'detect', label: 'Detect', title: 'Every frame is information.', description: 'Spot vehicle classes across footage.' },
  { id: 'track', label: 'Track', title: 'Follow the flow.', description: 'Connect visual observations over time.' },
  { id: 'review', label: 'Review', title: 'Context beyond the frame.', description: 'Keep session activity organized for review.' },
];

const capabilities = [
  {
    icon: ScanLine,
    number: '01',
    title: 'Vehicle detection',
    description: 'Identify supported road-user classes with YOLO11s running in the browser.',
  },
  {
    icon: Activity,
    number: '02',
    title: 'Visual tracking',
    description: 'Follow detected vehicles between observations with persistent track IDs.',
  },
  {
    icon: BarChart3,
    number: '03',
    title: 'Connected analytics',
    description: 'Explore session trends, vehicle-class counts, and analysis history.',
  },
  {
    icon: FileText,
    number: '04',
    title: 'Review & reports',
    description: 'Bring relevant observations into a more structured review workflow.',
  },
];

const steps = [
  {
    index: '01',
    icon: Film,
    title: 'Start with your footage',
    description: 'Choose a local video or approve a supported camera or browser-tab capture.',
  },
  {
    index: '02',
    icon: ScanLine,
    title: 'Analyze as it plays',
    description: 'See detections, track identifiers, and approximate motion alongside your video.',
  },
  {
    index: '03',
    icon: FileText,
    title: 'Make sense of it later',
    description: 'Return to saved session activity, analytics, reviews, and exportable reports.',
  },
];

function Brand() {
  return (
    <Link to="/" className="vl-brand" aria-label="VisionGuard home">
      <span className="vl-brand-symbol"><Shield size={20} strokeWidth={2.1} /><span /></span>
      <span>Vision<span className="vl-brand-regular">Guard</span><span className="vl-brand-stop">.</span></span>
    </Link>
  );
}

export function Landing() {
  const [preview, setPreview] = useState<Preview>('detect');
  const [mobileOpen, setMobileOpen] = useState(false);
  const selected = previews.find(item => item.id === preview) ?? previews[0];

  return (
    <div className="vl">
      <a href="#content" className="vl-skip">Skip to content</a>

      <header className="vl-header">
        <nav className="vl-container vl-nav" aria-label="Main navigation">
          <Brand />
          <div className="vl-nav-middle">
            <a href="#platform">Platform</a>
            <a href="#how-it-works">How it works</a>
            <a href="#principles">Our approach</a>
          </div>
          <div className="vl-nav-actions">
            <Link to="/login" className="vl-nav-signin">Sign in</Link>
            <Link to="/register" className="vl-button vl-button-primary vl-button-sm">
              Get started <ArrowUpRight size={16} />
            </Link>
          </div>
          <button
            type="button"
            className="vl-menu-toggle"
            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileOpen}
            aria-controls="vl-mobile-menu"
            onClick={() => setMobileOpen(open => !open)}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </nav>
        {mobileOpen && (
          <div id="vl-mobile-menu" className="vl-mobile-menu">
            <a href="#platform" onClick={() => setMobileOpen(false)}>Platform <ChevronRight size={16} /></a>
            <a href="#how-it-works" onClick={() => setMobileOpen(false)}>How it works <ChevronRight size={16} /></a>
            <a href="#principles" onClick={() => setMobileOpen(false)}>Our approach <ChevronRight size={16} /></a>
            <Link to="/login" onClick={() => setMobileOpen(false)}>Sign in <ChevronRight size={16} /></Link>
            <Link to="/register" className="vl-mobile-cta" onClick={() => setMobileOpen(false)}>Get started <ArrowUpRight size={17} /></Link>
          </div>
        )}
      </header>

      <main id="content">
        <section className="vl-hero">
          <div className="vl-hero-grid" aria-hidden="true" />
          <div className="vl-container vl-hero-inner">
            <div className="vl-hero-copy">
              <div className="vl-eyebrow"><span className="vl-eyebrow-spark"><Sparkles size={13} /></span> SEE BEYOND THE FOOTAGE</div>
              <h1>Every frame<br />tells a <span>story.</span></h1>
              <p className="vl-hero-lead">Turn traffic footage into a clearer picture of what’s happening on the road.</p>
              <p className="vl-hero-support">Detect vehicles, follow movement, and bring your analysis, history, and reviews into one intelligent workspace.</p>
              <div className="vl-hero-actions">
                <Link className="vl-button vl-button-primary vl-button-lg" to="/register">
                  Start analyzing <ArrowUpRight size={18} />
                </Link>
                <a className="vl-button vl-button-secondary vl-button-lg" href="#platform">
                  Explore the platform <ArrowRight size={17} />
                </a>
              </div>
              <div className="vl-hero-note"><CheckCircle2 size={16} /><span>Browser-based analysis</span><span className="vl-note-dot" /><span>Cloud video upload is optional</span></div>
            </div>

            <div className="vl-hero-art">
              <div className="vl-hero-art-glow" aria-hidden="true" />
              <div className="vl-hero-decoration vl-hero-decoration-top" aria-hidden="true">VG / VISUAL INTELLIGENCE</div>
              <div className="vl-preview">
                <div className="vl-preview-header">
                  <div className="vl-preview-window-dots" aria-hidden="true"><span /><span /><span /></div>
                  <span className="vl-preview-title">VisionGuard <span>/</span> Analysis workspace</span>
                  <span className="vl-preview-demo">CONCEPT PREVIEW</span>
                </div>
                <div className="vl-preview-body">
                  <div className="vl-preview-sidebar" aria-hidden="true">
                    <div className="vl-sidebar-logo"><Shield size={16} /></div>
                    <span className="vl-sidebar-icon vl-sidebar-icon-active"><ScanLine size={15} /></span>
                    <span className="vl-sidebar-icon"><BarChart3 size={15} /></span>
                    <span className="vl-sidebar-icon"><Database size={15} /></span>
                    <span className="vl-sidebar-icon"><FileText size={15} /></span>
                    <span className="vl-sidebar-bottom"><Layers3 size={14} /></span>
                  </div>
                  <div className="vl-preview-main">
                    <div className="vl-preview-main-head">
                      <div><span className="vl-preview-micro">ANALYSIS / DEMONSTRATION</span><strong>Traffic overview</strong></div>
                      <span className="vl-preview-status"><span /> LOCAL VIEW</span>
                    </div>
                    <div className={'vl-preview-scene vl-preview-scene-' + preview}>
                      <img
                        src="/traffic_monitoring_corridor.jpg"
                        alt="Traffic on a road viewed from above, used in an illustrative analysis preview"
                        loading="eager"
                      />
                      <span className="vl-scene-vignette" aria-hidden="true" />
                      {preview !== 'review' && (
                        <div className="vl-scene-overlays" aria-hidden="true">
                          <div className="vl-detection vl-detection-a"><span>#08 CAR</span></div>
                          <div className="vl-detection vl-detection-b"><span>#12 TRUCK</span></div>
                          {preview === 'track' && <div className="vl-tracking-path"><span /><span /><span /><span /></div>}
                        </div>
                      )}
                      {preview === 'review' && (
                        <div className="vl-preview-review" aria-hidden="true">
                          <span className="vl-review-title"><CheckCircle2 size={15} /> SESSION OVERVIEW</span>
                          <span>Video activity <Check size={14} /></span>
                          <span>Vehicle classes <Check size={14} /></span>
                          <span>Review timeline <Check size={14} /></span>
                        </div>
                      )}
                      <div className="vl-scene-footer"><span>ILLUSTRATIVE VISUALIZATION</span><span>FRAME / CONCEPT</span></div>
                    </div>
                    <div className="vl-preview-bottom">
                      <span className="vl-preview-progress"><span /></span>
                      <div className="vl-preview-bottom-meta"><span>{selected.title}</span><span>YOLO11s · ONNX</span></div>
                    </div>
                  </div>
                </div>
                <div className="vl-preview-switcher" aria-label="Preview the VisionGuard workflow">
                  {previews.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      className={preview === item.id ? 'vl-preview-switch-active' : ''}
                      aria-pressed={preview === item.id}
                      onClick={() => setPreview(item.id)}
                    >
                      <span>{item.label}</span><ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="vl-hero-float vl-hero-float-top"><span><ScanLine size={17} /></span><div>Computer vision<small>YOLO11s MODEL</small></div></div>
              <div className="vl-hero-float vl-hero-float-bottom"><span><Activity size={17} /></span><div>From pixels to insight<small>DETECTION · TRACKING · REVIEW</small></div></div>
              <div className="vl-hero-decoration vl-hero-decoration-bottom" aria-hidden="true">DESIGNED FOR CLARITY / 001</div>
            </div>
          </div>

          <div className="vl-container vl-tech-strip">
            <span>POWERING THE WORKFLOW</span>
            <div><span><ScanLine size={15} /> YOLO11s</span><span><Layers3 size={15} /> ONNX Runtime Web</span><span><Activity size={15} /> Optical tracking</span><span><ShieldCheck size={15} /> Review-first design</span></div>
          </div>
        </section>

        <section id="platform" className="vl-section vl-platform">
          <div className="vl-container">
            <div className="vl-section-head">
              <div><p className="vl-overline">01 <span>/</span> THE PLATFORM</p><h2>Everything you need.<br /><em>Nothing in the way.</em></h2></div>
              <p>Powerful analysis doesn't have to feel complicated. VisionGuard brings the pieces together in a workspace made for understanding.</p>
            </div>

            <div className="vl-feature-showcase">
              <div className="vl-showcase-copy">
                <span className="vl-pill"><span /> ONE CONNECTED WORKSPACE</span>
                <h3>From observation<br />to understanding.</h3>
                <p>See detections, explore trends, return to past sessions, and organize what needs reviewing—without switching between disconnected tools.</p>
                <Link to="/register">Explore VisionGuard <ArrowUpRight size={16} /></Link>
              </div>
              <div className="vl-showcase-screen">
                <div className="vl-showcase-screen-top"><span><span /> APPLICATION PREVIEW</span><span>WORKSPACE</span></div>
                <img src="/platform_preview.png" alt="Preview of VisionGuard's application workspace" loading="lazy" />
              </div>
            </div>

            <div className="vl-capability-grid">
              {capabilities.map(({ icon: Icon, number, title, description }) => (
                <article className="vl-capability" key={number}>
                  <div className="vl-capability-top"><span className="vl-capability-icon"><Icon size={22} strokeWidth={1.7} /></span><span>{number}</span></div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <span className="vl-capability-arrow"><ArrowUpRight size={18} /></span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="vl-section vl-workflow">
          <div className="vl-container">
            <div className="vl-section-head vl-section-head-workflow">
              <div><p className="vl-overline">02 <span>/</span> HOW IT WORKS</p><h2>Three steps.<br /><em>A clearer picture.</em></h2></div>
              <p>From your first frame to your next decision, the process stays refreshingly straightforward.</p>
            </div>
            <div className="vl-steps">
              {steps.map(({ icon: Icon, index, title, description }) => (
                <article className="vl-step" key={index}>
                  <div className="vl-step-head"><span>{index}</span><span className="vl-step-line" /></div>
                  <div className="vl-step-icon"><Icon size={25} strokeWidth={1.6} /></div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="principles" className="vl-section vl-principles">
          <div className="vl-container vl-principles-layout">
            <div className="vl-principles-copy">
              <p className="vl-overline">03 <span>/</span> OUR APPROACH</p>
              <h2>Smart technology.<br /><em>Grounded in reality.</em></h2>
              <p>Better road intelligence starts with being clear about what a model can—and cannot—tell you. That's part of the design, not an afterthought.</p>
              <Link className="vl-button vl-button-secondary" to="/register">Experience the workspace <ArrowUpRight size={17} /></Link>
            </div>
            <div className="vl-principle-list">
              <div className="vl-principle">
                <span><LockKeyhole size={21} /></span>
                <div><h3>Your footage, your choice.</h3><p>Local browser processing doesn't require uploading the original video. Optional cloud backup depends on server configuration and your explicit action.</p></div>
              </div>
              <div className="vl-principle">
                <span><Activity size={21} /></span>
                <div><h3>Estimates are estimates.</h3><p>Image-derived speed and motion values are approximate until the camera geometry and measurements are properly calibrated.</p></div>
              </div>
              <div className="vl-principle">
                <span><ShieldCheck size={21} /></span>
                <div><h3>Human review matters.</h3><p>AI-assisted observations support investigations and reporting; they shouldn't be treated as verified enforcement decisions on their own.</p></div>
              </div>
            </div>
          </div>
        </section>

        <section className="vl-bottom-section">
          <div className="vl-container">
            <div className="vl-cta">
              <div className="vl-cta-orb vl-cta-orb-a" aria-hidden="true" /><div className="vl-cta-orb vl-cta-orb-b" aria-hidden="true" />
              <div className="vl-cta-kicker"><Sparkles size={15} /> READY WHEN YOU ARE</div>
              <h2>See the road<br /><span>differently.</span></h2>
              <p>Bring your footage, discover the signals, and build a clearer understanding of traffic activity.</p>
              <div className="vl-cta-actions">
                <Link to="/register" className="vl-button vl-button-primary vl-button-lg">Get started with VisionGuard <ArrowUpRight size={18} /></Link>
                <Link to="/login">Already have an account? Sign in <ArrowRight size={15} /></Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="vl-footer">
        <div className="vl-container vl-footer-main">
          <div><Brand /><p>A clearer view of every journey.</p></div>
          <div className="vl-footer-links"><a href="#platform">Platform</a><a href="#how-it-works">How it works</a><a href="#principles">Our approach</a><Link to="/login">Sign in</Link></div>
        </div>
        <div className="vl-container vl-footer-bottom"><span>© {new Date().getFullYear()} VisionGuard. All rights reserved.</span><span><ShieldCheck size={15} /> AI-assisted analysis. Human-verified decisions.</span></div>
      </footer>
    </div>
  );
}
