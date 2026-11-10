import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3,
  Check, CheckCircle2, ChevronRight, CircleDot, FileText, Film,
  Fingerprint, Layers3, LockKeyhole, Menu, ScanLine, Shield,
  ShieldCheck, Sparkles, X,
} from 'lucide-react';
import './Landing.css';

type GalleryView = 'scenes' | 'movement' | 'workspace';

const gallery = [
  {
    id: 'scenes' as const,
    number: '01',
    label: 'Scenes',
    headline: 'Start with the road.',
    detail: 'Clear visual context is where useful analysis begins.',
    src: '/traffic_operations_center.jpg',
    alt: 'Illustrative traffic operations scene',
  },
  {
    id: 'movement' as const,
    number: '02',
    label: 'Movement',
    headline: 'Watch the patterns.',
    detail: 'Review vehicle activity and movement in the original scene.',
    src: '/traffic_flow_analysis.jpg',
    alt: 'Illustrative aerial traffic-flow scene',
  },
  {
    id: 'workspace' as const,
    number: '03',
    label: 'Workspace',
    headline: 'Connect the insights.',
    detail: 'A central home for analysis sessions and review workflows.',
    src: '/traffic_monitoring_corridor.jpg',
    alt: 'Illustrative road-monitoring corridor',
  },
];

const capabilities = [
  {
    n: '01',
    label: 'DETECT',
    icon: ScanLine,
    title: 'Identify what matters.',
    description: 'YOLO11s recognizes supported vehicle types from footage. Detections depend on image quality and model performance.',
  },
  {
    n: '02',
    label: 'TRACK',
    icon: Fingerprint,
    title: 'Follow what moves.',
    description: 'Visual tracking links detections across frames and keeps vehicle identifiers connected to observations.',
  },
  {
    n: '03',
    label: 'UNDERSTAND',
    icon: BarChart3,
    title: 'Make movement meaningful.',
    description: 'Bring vehicle classes, session summaries, and activity history into a connected analytical view.',
  },
  {
    n: '04',
    label: 'REVIEW',
    icon: FileText,
    title: 'Keep the bigger picture.',
    description: 'Organize incidents and reports for inspection, with people responsible for verification.',
  },
];

const process = [
  { n: '01', icon: Film, title: 'Choose your footage', detail: 'Select a local video or approve a supported live capture source.' },
  { n: '02', icon: ScanLine, title: 'Run the analysis', detail: 'Detect vehicles and observe movement with visible tracks.' },
  { n: '03', icon: Layers3, title: 'Explore the insights', detail: 'Return to your history, analytics, incidents, and reports.' },
];

function Brand() {
  return (
    <Link to="/" className="vgx-brand" aria-label="VisionGuard homepage">
      <span className="vgx-brand-icon" aria-hidden="true"><Shield size={21} strokeWidth={2.1} /><span /></span>
      <span>Vision<strong>Guard</strong><i>.</i></span>
    </Link>
  );
}

export function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [galleryView, setGalleryView] = useState<GalleryView>('scenes');
  const activeView = gallery.find(item => item.id === galleryView) ?? gallery[0];

  return (
    <div className="vgx">
      <a href="#content" className="vgx-skip">Skip to content</a>

      <header className="vgx-header">
        <nav className="vgx-wrap vgx-nav" aria-label="Primary navigation">
          <Brand />
          <div className="vgx-nav-links">
            <a href="#vision">The vision</a>
            <a href="#explore">Explore</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#workflow">How it works</a>
          </div>
          <div className="vgx-nav-actions">
            <Link to="/login" className="vgx-signin">Sign in</Link>
            <Link to="/register" className="vgx-btn vgx-btn-primary vgx-btn-small">Get started <ArrowUpRight size={16} /></Link>
          </div>
          <button
            type="button"
            className="vgx-mobile-menu-button"
            aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileMenuOpen}
            aria-controls="vgx-mobile-menu"
            onClick={() => setMobileMenuOpen(value => !value)}
          >
            {mobileMenuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </nav>
        {mobileMenuOpen && (
          <div id="vgx-mobile-menu" className="vgx-mobile-menu">
            <a href="#vision" onClick={() => setMobileMenuOpen(false)}>The vision <ChevronRight size={17} /></a>
            <a href="#explore" onClick={() => setMobileMenuOpen(false)}>Explore <ChevronRight size={17} /></a>
            <a href="#capabilities" onClick={() => setMobileMenuOpen(false)}>Capabilities <ChevronRight size={17} /></a>
            <a href="#workflow" onClick={() => setMobileMenuOpen(false)}>How it works <ChevronRight size={17} /></a>
            <Link to="/login" onClick={() => setMobileMenuOpen(false)}>Sign in <ArrowUpRight size={17} /></Link>
            <Link to="/register" className="vgx-mobile-menu-primary" onClick={() => setMobileMenuOpen(false)}>Get started <ArrowUpRight size={17} /></Link>
          </div>
        )}
      </header>

      <main id="content">
        <section className="vgx-hero" id="vision">
          <div className="vgx-wrap">
            <div className="vgx-hero-meta">
              <span className="vgx-eyebrow"><CircleDot size={13} /> THE NEXT PERSPECTIVE ON TRAFFIC</span>
              <span className="vgx-edition">VISUAL INTELLIGENCE / 01</span>
            </div>
            <div className="vgx-hero-heading">
              <div>
                <h1>See beyond<br />the <span>ordinary.</span></h1>
              </div>
              <div className="vgx-hero-aside">
                <span className="vgx-hero-glyph" aria-hidden="true"><ArrowDownRight size={31} strokeWidth={1.5} /></span>
                <p>More than boxes on a screen. VisionGuard connects traffic footage, visual tracking, and insights in a workspace made for understanding the road.</p>
                <div className="vgx-hero-actions">
                  <Link to="/register" className="vgx-btn vgx-btn-primary vgx-btn-large">Open VisionGuard <ArrowUpRight size={19} /></Link>
                  <a href="#explore" className="vgx-text-link">Discover the platform <ArrowRight size={17} /></a>
                </div>
              </div>
            </div>
            <div className="vgx-hero-tags">
              <span><CheckCircle2 size={15} /> Analyze in your browser</span>
              <span><CheckCircle2 size={15} /> Choose when to store video</span>
              <span><CheckCircle2 size={15} /> Keep human review central</span>
            </div>

            <div className="vgx-hero-scene">
              <div className="vgx-hero-photo">
                <img src="/traffic_operations_center.jpg" alt="Illustrative roadway and traffic operations scene" fetchPriority="high" />
                <div className="vgx-hero-photo-shade" aria-hidden="true" />
                <div className="vgx-hero-photo-top"><span><span className="vgx-status-dot" /> A CLOSER LOOK AT THE ROAD</span><span>01 / 03</span></div>
                <div className="vgx-hero-photo-bottom">
                  <div><small>THE BIGGER PICTURE</small><strong>Context changes everything.</strong></div>
                  <span className="vgx-hero-frame-icon" aria-hidden="true"><ScanLine size={26} strokeWidth={1.4} /></span>
                </div>
              </div>
              <div className="vgx-hero-side">
                <div className="vgx-hero-small-photo">
                  <img src="/traffic_flow_analysis.jpg" alt="Illustrative traffic-flow photography" loading="lazy" />
                  <span>TRAFFIC / FLOW <ArrowUpRight size={16} /></span>
                </div>
                <div className="vgx-hero-info-card">
                  <div className="vgx-info-icon"><Activity size={24} strokeWidth={1.5} /></div>
                  <div><span>DETECTION. TRACKING. INSIGHT.</span><strong>A different way<br />to see movement.</strong></div>
                  <ArrowUpRight className="vgx-info-arrow" size={23} />
                </div>
              </div>
            </div>
            <div className="vgx-hero-photo-foot">
              <span>VISIONGUARD — TRAFFIC INTELLIGENCE</span>
              <span>Illustrative imagery · Explore the actual workspace to run analysis</span>
            </div>
          </div>
        </section>

        <section className="vgx-statement">
          <div className="vgx-wrap vgx-statement-grid">
            <div className="vgx-section-code"><span>01 / THE IDEA</span><span className="vgx-code-dash" /></div>
            <div>
              <h2>Traffic tells a story.<br /><em>Make sense of it.</em></h2>
              <p>VisionGuard goes beyond a single frame—connecting vehicle detection, tracking, historical activity, and review. Less jumping between tools. More clarity where it counts.</p>
            </div>
          </div>
        </section>

        <section className="vgx-explore" id="explore">
          <div className="vgx-wrap">
            <div className="vgx-section-kicker"><span>02 / TAKE A LOOK INSIDE</span><span>ONE PLATFORM, MORE PERSPECTIVES</span></div>
            <div className="vgx-section-heading">
              <h2>From a moment<br />to a <em>fuller picture.</em></h2>
              <p>Explore the different perspectives behind traffic analysis. Every frame is a starting point—not the entire answer.</p>
            </div>
            <div className="vgx-gallery">
              <div className="vgx-gallery-main">
                <div className="vgx-gallery-image">
                  <img src={activeView.src} alt={activeView.alt} loading="lazy" key={activeView.id} />
                  <span className="vgx-gallery-image-index">VISION / {activeView.number}</span>
                  <span className="vgx-gallery-image-caption">Illustrative scene — not live AI output</span>
                </div>
                <div className="vgx-gallery-details">
                  <div><span>0{gallery.findIndex(item => item.id === galleryView) + 1} / PERSPECTIVE</span><h3>{activeView.headline}</h3><p>{activeView.detail}</p></div>
                  <ArrowUpRight size={25} />
                </div>
              </div>
              <div className="vgx-gallery-aside">
                <div className="vgx-gallery-options" role="group" aria-label="Select a traffic perspective">
                  {gallery.map(item => (
                    <button
                      type="button"
                      key={item.id}
                      className={'vgx-gallery-tab' + (galleryView === item.id ? ' vgx-gallery-tab-active' : '')}
                      aria-pressed={galleryView === item.id}
                      onClick={() => setGalleryView(item.id)}
                    >
                      <span>{item.number}</span><strong>{item.label}</strong><ArrowUpRight size={17} />
                    </button>
                  ))}
                </div>
                <div className="vgx-gallery-secondary">
                  <img src="/landing_hero.jpg" alt="Illustrative roadway photography" loading="lazy" />
                  <div><span>BEYOND THE FRAME</span><strong>Every angle adds perspective.</strong></div>
                </div>
              </div>
            </div>
            <div className="vgx-gallery-bottom">
              <span><Sparkles size={15} /> Concept imagery is illustrative. Actual detections appear in the analysis workspace.</span>
              <Link to="/register">Explore the workspace <ArrowUpRight size={17} /></Link>
            </div>
          </div>
        </section>

        <section className="vgx-capabilities" id="capabilities">
          <div className="vgx-wrap">
            <div className="vgx-section-kicker"><span>03 / WHAT'S INSIDE</span><span>BUILT AROUND THE WAY YOU WORK</span></div>
            <div className="vgx-section-heading vgx-section-heading-tight">
              <h2>Powerful underneath.<br /><em>Clear on the surface.</em></h2>
              <p>Purposeful tools from the first detection to the final review.</p>
            </div>
            <div className="vgx-capability-list">
              {capabilities.map(({ n, icon: Icon, label, title, description }) => (
                <article className="vgx-capability" key={n}>
                  <span className="vgx-capability-count">{n}</span>
                  <div className="vgx-capability-title"><span className="vgx-capability-icon"><Icon size={24} strokeWidth={1.7} /></span><div><span>{label}</span><h3>{title}</h3></div></div>
                  <p>{description}</p>
                  <span className="vgx-capability-arrow"><ArrowUpRight size={21} /></span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="vgx-visual-story">
          <div className="vgx-wrap vgx-visual-story-grid">
            <div className="vgx-visual-story-image">
              <img src="/traffic_monitoring_corridor.jpg" alt="Illustrative view of traffic along a road corridor" loading="lazy" />
              <div className="vgx-story-image-label"><span>TRAFFIC INTELLIGENCE</span><span>VISUAL CONTEXT / 04</span></div>
            </div>
            <div className="vgx-visual-story-copy">
              <span>FROM THE ROAD TO THE RECORD</span>
              <h2>Clarity at<br />every <em>step.</em></h2>
              <p>One workflow helps you turn footage into reviewable information, without losing sight of where each observation came from.</p>
              <Link to="/register" className="vgx-btn vgx-btn-light vgx-btn-large">Explore VisionGuard <ArrowUpRight size={18} /></Link>
            </div>
          </div>
        </section>

        <section className="vgx-workflow" id="workflow">
          <div className="vgx-wrap">
            <div className="vgx-section-kicker"><span>04 / THE WORKFLOW</span><span>THREE STEPS FROM START TO INSIGHT</span></div>
            <div className="vgx-section-heading vgx-workflow-heading">
              <h2>It starts with<br /><em>one frame.</em></h2>
              <p>Designed to make traffic analysis approachable, while leaving the detailed work to the application.</p>
            </div>
            <div className="vgx-workflow-grid">
              {process.map(({ n, title, detail, icon: Icon }) => (
                <article className="vgx-workflow-card" key={n}>
                  <div><span>{n}</span><Icon size={26} strokeWidth={1.5} /></div>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                  <span className="vgx-step-line" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="vgx-trust">
          <div className="vgx-wrap vgx-trust-grid">
            <div className="vgx-trust-heading">
              <span>05 / BUILT WITH CONTEXT</span>
              <h2>Smart technology.<br /><em>Clear boundaries.</em></h2>
              <p>Good intelligence explains its limits. VisionGuard keeps decisions about footage, measurements, and review in view.</p>
            </div>
            <div className="vgx-trust-list">
              <div><LockKeyhole size={23} /><section><h3>Storage stays a choice.</h3><p>Supported video analysis can run in your browser. Local retention is optional; cloud originals require explicit upload and configured storage.</p></section><span>01</span></div>
              <div><Activity size={23} /><section><h3>Speed is an estimate.</h3><p>Image-derived motion proxies are not calibrated road-speed measurements or confirmed evidence of speeding.</p></section><span>02</span></div>
              <div><ShieldCheck size={23} /><section><h3>Human review comes first.</h3><p>Automated observations support further investigation and verification; they do not replace human judgement.</p></section><span>03</span></div>
            </div>
          </div>
        </section>

        <section className="vgx-final">
          <div className="vgx-wrap">
            <div className="vgx-final-inner">
              <div className="vgx-final-orbit" aria-hidden="true"><span /><span /><span /></div>
              <div className="vgx-final-copy">
                <span>YOUR NEXT PERSPECTIVE STARTS HERE</span>
                <h2>See the road<br /><em>differently.</em></h2>
                <p>Bring your footage into a workspace built for clearer observations, connected insights, and responsible review.</p>
                <div><Link to="/register" className="vgx-btn vgx-btn-white vgx-btn-large">Get started <ArrowUpRight size={18} /></Link><Link to="/login" className="vgx-final-login">Already have an account? Sign in <ArrowRight size={16} /></Link></div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="vgx-footer">
        <div className="vgx-wrap">
          <div className="vgx-footer-main">
            <div><Brand /><p>Traffic intelligence, made easier to understand.</p></div>
            <div><a href="#vision">Home</a><a href="#explore">Explore</a><a href="#capabilities">Capabilities</a><a href="#workflow">Workflow</a><Link to="/login">Sign in</Link></div>
          </div>
          <div className="vgx-footer-bottom"><span>© {new Date().getFullYear()} VisionGuard. All rights reserved.</span><span><ShieldCheck size={15} /> AI-assisted analysis · Human-verified decisions</span></div>
        </div>
      </footer>
    </div>
  );
}
