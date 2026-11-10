import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowRight, ArrowUpRight, BarChart3, Check, ChevronDown,
  ChevronRight, CircleDot, CloudOff, FileText, Film, Layers3, LockKeyhole,
  Menu, MousePointer2, ScanLine, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import './Landing.css';

type Perspective = 'observe' | 'follow' | 'review';

const perspectives: Array<{
  id: Perspective;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  image: string;
  alt: string;
}> = [
  {
    id: 'observe',
    label: 'Observe',
    eyebrow: '01 / ORIGINAL CONTEXT',
    title: 'Start with the actual scene.',
    description: 'Choose your footage and make the road itself the starting point.',
    image: '/traffic_monitoring_corridor.jpg',
    alt: 'Illustrative road scene showing traffic in a corridor',
  },
  {
    id: 'follow',
    label: 'Follow',
    eyebrow: '02 / VEHICLE MOVEMENT',
    title: 'Follow what moves.',
    description: 'In the analysis workspace, YOLO11s and tracking tools help connect observations over time.',
    image: '/traffic_flow_analysis.jpg',
    alt: 'Illustrative aerial view of traffic flow',
  },
  {
    id: 'review',
    label: 'Review',
    eyebrow: '03 / THE BIGGER PICTURE',
    title: 'See beyond a single frame.',
    description: 'Return to session activity, analytics and review tools after playback.',
    image: '/traffic_operations_center.jpg',
    alt: 'Illustrative traffic operations scene',
  },
];

const capabilities = [
  {
    number: '01',
    icon: ScanLine,
    title: 'Vehicle detection',
    text: 'Identify supported road-user classes using YOLO11s and ONNX Runtime Web.',
  },
  {
    number: '02',
    icon: Activity,
    title: 'Visual tracking',
    text: 'Follow detected vehicles with track identifiers and image-derived motion estimates.',
  },
  {
    number: '03',
    icon: BarChart3,
    title: 'Useful analytics',
    text: 'Explore recorded sessions, vehicle classes and activity in a connected workspace.',
  },
  {
    number: '04',
    icon: FileText,
    title: 'Human-led review',
    text: 'Bring findings into incident review and reporting without treating estimates as proof.',
  },
];

const process = [
  {
    step: '01',
    icon: Film,
    title: 'Bring the footage.',
    detail: 'Select a video or approve a supported capture source.',
  },
  {
    step: '02',
    icon: ScanLine,
    title: 'Explore the activity.',
    detail: 'Run the detector and review how vehicles move through the frame.',
  },
  {
    step: '03',
    icon: Layers3,
    title: 'Keep the context.',
    detail: 'Open your history, analytics and review tools when needed.',
  },
];

function Brand() {
  return (
    <Link to="/" className="vgn-brand" aria-label="VisionGuard homepage">
      <img src="/brand-mark.svg?v=20261111" alt="" width="37" height="37" />
      <span>Vision<strong>Guard</strong><i>.</i></span>
    </Link>
  );
}

export function Landing() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [perspective, setPerspective] = useState<Perspective>('observe');
  const selected = perspectives.find(item => item.id === perspective) ?? perspectives[0];

  return (
    <div className="vgn">
      <a href="#main" className="vgn-skip">Skip to content</a>

      <header className="vgn-header">
        <nav className="vgn-shell vgn-nav" aria-label="Primary navigation">
          <Brand />
          <div className="vgn-nav-links">
            <a href="#platform">The platform</a>
            <a href="#capabilities">What it does</a>
            <a href="#workflow">How it works</a>
          </div>
          <div className="vgn-nav-actions">
            <Link className="vgn-sign-in" to="/login">Sign in</Link>
            <Link className="vgn-button vgn-button-nav" to="/register">Get started <ArrowUpRight size={16} /></Link>
          </div>
          <button
            type="button"
            className="vgn-menu-button"
            aria-expanded={mobileOpen}
            aria-controls="vgn-mobile-navigation"
            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
            onClick={() => setMobileOpen(open => !open)}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </nav>
        {mobileOpen && (
          <nav className="vgn-mobile-navigation" id="vgn-mobile-navigation" aria-label="Mobile navigation">
            <a href="#platform" onClick={() => setMobileOpen(false)}>The platform <ChevronRight size={16} /></a>
            <a href="#capabilities" onClick={() => setMobileOpen(false)}>What it does <ChevronRight size={16} /></a>
            <a href="#workflow" onClick={() => setMobileOpen(false)}>How it works <ChevronRight size={16} /></a>
            <Link to="/login" onClick={() => setMobileOpen(false)}>Sign in <ChevronRight size={16} /></Link>
            <Link className="vgn-mobile-primary" to="/register" onClick={() => setMobileOpen(false)}>Get started <ArrowUpRight size={17} /></Link>
          </nav>
        )}
      </header>

      <main id="main">
        <section className="vgn-hero">
          <div className="vgn-shell vgn-hero-grid">
            <div className="vgn-hero-content">
              <span className="vgn-eyebrow"><span /> TRAFFIC INTELLIGENCE, REIMAGINED</span>
              <h1>Every frame has<br /><em>more to say.</em></h1>
              <p>See movement, make sense of activity and keep the bigger picture in focus. One connected workspace for video-based traffic analysis.</p>
              <div className="vgn-hero-actions">
                <Link to="/register" className="vgn-button vgn-button-accent">Open VisionGuard <ArrowUpRight size={18} /></Link>
                <a href="#platform" className="vgn-button vgn-button-ghost">Explore the platform <ArrowRight size={17} /></a>
              </div>
              <div className="vgn-hero-footnote">
                <span><CircleDot size={14} /> Browser-based analysis</span>
                <span className="vgn-footnote-divider" />
                <span>Built for human review</span>
              </div>
            </div>

            <div className="vgn-hero-demo" id="demo">
              <div className="vgn-stage">
                <div className="vgn-stage-chrome">
                  <span className="vgn-stage-title"><span /> VISIONGUARD / SCENE EXPLORER</span>
                  <span className="vgn-stage-tag">INTERACTIVE PREVIEW</span>
                </div>
                <div className="vgn-stage-image" key={selected.id}>
                  <img src={selected.image} alt={selected.alt} fetchPriority={selected.id === 'observe' ? 'high' : 'auto'} />
                  <div className="vgn-stage-corner vgn-stage-corner-a" aria-hidden="true" />
                  <div className="vgn-stage-corner vgn-stage-corner-b" aria-hidden="true" />
                  <div className="vgn-stage-corner vgn-stage-corner-c" aria-hidden="true" />
                  <div className="vgn-stage-corner vgn-stage-corner-d" aria-hidden="true" />
                  <div className="vgn-stage-image-label">ILLUSTRATIVE SCENE — NO LIVE INFERENCE</div>
                  <div className="vgn-stage-image-no"><span>{selected.eyebrow}</span><strong>{selected.title}</strong></div>
                </div>
                <div className="vgn-stage-tabs" role="group" aria-label="Explore the VisionGuard analysis workflow">
                  <span>EXPLORE A PERSPECTIVE</span>
                  <div>
                    {perspectives.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className={item.id === perspective ? 'vgn-stage-tab vgn-stage-tab-active' : 'vgn-stage-tab'}
                        aria-pressed={item.id === perspective}
                        onClick={() => setPerspective(item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="vgn-demo-caption"><MousePointer2 size={13} /> {selected.description} <span>Illustration only · Try real analysis after sign-in</span></p>
            </div>
          </div>
        </section>

        <div className="vgn-rail">
          <div className="vgn-shell">
            <span>THE TOOLS BEHIND THE PICTURE</span>
            <div><span>YOLO11s</span><i /> <span>ONNX Runtime Web</span><i /><span>Visual tracking</span><i /><span>Session history</span></div>
          </div>
        </div>

        <section className="vgn-section vgn-intro" id="platform">
          <div className="vgn-shell">
            <div className="vgn-section-top"><span>01 / A CLEARER PERSPECTIVE</span><span>LESS NOISE. MORE CONTEXT.</span></div>
            <div className="vgn-intro-heading">
              <h2>More than a box<br />around a <em>vehicle.</em></h2>
              <div>
                <p>Video analysis should help you understand what happened—not leave you with disconnected detections and numbers.</p>
                <p>VisionGuard connects the visual moment to a broader workflow: track activity, explore results, and return to sessions later.</p>
              </div>
            </div>

            <div className="vgn-editorial-grid">
              <article className="vgn-editorial-main">
                <div className="vgn-card-index">01 / THE SCENE</div>
                <div className="vgn-editorial-art">
                  <img src="/traffic_flow_analysis.jpg" alt="Illustrative overhead view of road traffic" loading="lazy" />
                  <span className="vgn-art-label">ORIGINAL FOOTAGE PROVIDES THE CONTEXT</span>
                </div>
                <div className="vgn-editorial-copy">
                  <h3>Keep your eyes<br />on the whole story.</h3>
                  <p>Start with the road. Let the analysis add useful observations without taking the scene away.</p>
                </div>
              </article>
              <div className="vgn-editorial-aside">
                <article className="vgn-editorial-detail">
                  <div className="vgn-card-index">02 / THE WORKFLOW</div>
                  <div className="vgn-detail-art" aria-hidden="true">
                    <span className="vgn-detail-line" />
                    <div><ScanLine size={17} /><span>Detection</span><b>01</b></div>
                    <div><Activity size={17} /><span>Tracking</span><b>02</b></div>
                    <div><BarChart3 size={17} /><span>Analysis</span><b>03</b></div>
                  </div>
                  <div className="vgn-small-copy"><h3>From frames to findings.</h3><p>One journey from footage to recorded activity.</p></div>
                </article>
                <article className="vgn-editorial-note">
                  <div className="vgn-card-index">03 / YOUR DECISION</div>
                  <LockKeyhole size={29} strokeWidth={1.55} aria-hidden="true" />
                  <div className="vgn-small-copy"><h3>Your footage. Your call.</h3><p>Browser analysis doesn't require sending the original file to cloud storage.</p></div>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section className="vgn-section vgn-capabilities" id="capabilities">
          <div className="vgn-shell">
            <div className="vgn-section-top vgn-section-top-dark"><span>02 / THE TOOLKIT</span><span>MADE TO WORK TOGETHER</span></div>
            <div className="vgn-capability-heading">
              <h2>Under the hood,<br /><em>real capability.</em></h2>
              <p>Four connected ways to turn moving pixels into something you can actually review.</p>
            </div>
            <div className="vgn-capability-grid">
              {capabilities.map(({ number, title, text, icon: Icon }) => (
                <article className="vgn-capability" key={number}>
                  <div className="vgn-capability-top"><span>{number} / 04</span><Icon size={22} strokeWidth={1.5} /></div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="vgn-section vgn-how" id="workflow">
          <div className="vgn-shell">
            <div className="vgn-section-top"><span>03 / THE SIMPLE PROCESS</span><span>THREE STEPS TO START</span></div>
            <div className="vgn-how-heading">
              <h2>From upload<br />to <em>understanding.</em></h2>
              <p>Bring the footage. Explore what's visible. Return when you need the context again.</p>
            </div>
            <div className="vgn-steps">
              {process.map(({ step, icon: Icon, title, detail }) => (
                <article key={step} className="vgn-step">
                  <div className="vgn-step-top"><span>{step}</span><Icon size={25} strokeWidth={1.5} /></div>
                  <h3>{title}</h3><p>{detail}</p>
                </article>
              ))}
            </div>
            <div className="vgn-honesty">
              <span className="vgn-honesty-mark"><ShieldCheck size={23} strokeWidth={1.7} /></span>
              <div><strong>Meaningful insights. Real-world limits.</strong><p>Image-derived speed is an estimate, not a calibrated measurement. Cloud video backup requires explicit upload and configured storage. AI-generated findings always need human review.</p></div>
            </div>
          </div>
        </section>

        <section className="vgn-cta">
          <div className="vgn-shell vgn-cta-grid">
            <div>
              <span className="vgn-cta-eyebrow"><Sparkles size={16} /> THE ROAD LOOKS DIFFERENT FROM HERE</span>
              <h2>See what your<br /><em>footage can say.</em></h2>
              <p>Less guesswork between the scene and the insight. Explore VisionGuard's connected analysis workspace.</p>
              <div className="vgn-cta-actions">
                <Link className="vgn-button vgn-button-cta" to="/register">Get started <ArrowUpRight size={18} /></Link>
                <Link to="/login" className="vgn-cta-signin">Already have an account? Sign in <ArrowRight size={16} /></Link>
              </div>
            </div>
            <div className="vgn-cta-image" aria-hidden="true">
              <div className="vgn-cta-ring vgn-cta-ring-a" /><div className="vgn-cta-ring vgn-cta-ring-b" />
              <div className="vgn-cta-mark"><ScanLine size={91} strokeWidth={1.12} /></div>
              <div className="vgn-cta-tag">FRAME BY FRAME. BIGGER PICTURE.</div>
            </div>
          </div>
        </section>
      </main>

      <footer className="vgn-footer">
        <div className="vgn-shell vgn-footer-top">
          <Brand />
          <span>Built for clarity on the road.</span>
          <div><a href="#platform">Platform</a><a href="#capabilities">Capabilities</a><a href="#workflow">Workflow</a><Link to="/login">Sign in</Link></div>
        </div>
        <div className="vgn-shell vgn-footer-bottom">
          <span>© {new Date().getFullYear()} VisionGuard. All rights reserved.</span>
          <span><ShieldCheck size={14} /> Assistive analysis. Human decisions.</span>
        </div>
      </footer>
    </div>
  );
}
