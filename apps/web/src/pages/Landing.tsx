import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, Check,
  ChevronRight, CirclePlay, FileText, Film, Layers3, LockKeyhole,
  Menu, MoveUpRight, Pause, Play, Radar, ScanLine, Shield, ShieldCheck,
  Sparkles, Video, X,
} from 'lucide-react';
import './Landing.css';

type Lens = 'observe' | 'follow' | 'understand';

const lenses: Array<{
  id: Lens;
  n: string;
  label: string;
  title: string;
  explanation: string;
}> = [
  {
    id: 'observe',
    n: '01',
    label: 'Observe',
    title: 'Start with what is actually there.',
    explanation: 'Bring your own traffic footage into the analysis workspace. The original picture remains the starting point.',
  },
  {
    id: 'follow',
    n: '02',
    label: 'Follow',
    title: 'See movement as a connected story.',
    explanation: 'YOLO11s detection and visual tracking add vehicle classes and track IDs when you analyze footage in the app.',
  },
  {
    id: 'understand',
    n: '03',
    label: 'Understand',
    title: 'Make observations useful after playback.',
    explanation: 'Bring session activity into your history, analytics, incident review, and reports—without losing the context.',
  },
];

const capabilities = [
  {
    number: '01',
    icon: ScanLine,
    name: 'Detection',
    title: 'Know what is on the road.',
    copy: 'YOLO11s identifies supported vehicle categories from video frames. Actual results depend on footage and model performance.',
    detail: 'YOLO11s / ONNX',
  },
  {
    number: '02',
    icon: Activity,
    name: 'Tracking',
    title: 'Keep the picture connected.',
    copy: 'Visual tracking links vehicle observations across frames using persistent identifiers and motion cues.',
    detail: 'FRAME-TO-FRAME',
  },
  {
    number: '03',
    icon: BarChart3,
    name: 'Intelligence',
    title: 'Find the signal in the movement.',
    copy: 'Explore vehicle classes, session summaries, and the analysis history associated with your account.',
    detail: 'CONNECTED DATA',
  },
  {
    number: '04',
    icon: FileText,
    name: 'Review',
    title: 'Go from seeing to understanding.',
    copy: 'Organize observations for further inspection and export reports, with human verification kept central.',
    detail: 'REVIEW-FIRST',
  },
];

const workflow = [
  {
    count: '01',
    title: 'Bring the video',
    copy: 'Upload footage locally or explicitly approve a camera or supported browser-tab source.',
    icon: Film,
  },
  {
    count: '02',
    title: 'Find the motion',
    copy: 'Use the analysis workspace to detect road users and follow visual tracks during playback.',
    icon: Radar,
  },
  {
    count: '03',
    title: 'Keep the context',
    copy: 'Review session history, analytics, incidents, and exportable information in one place.',
    icon: Layers3,
  },
];

function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <Link to="/" className={'vx-brand' + (footer ? ' vx-brand-footer' : '')} aria-label="VisionGuard home">
      <span className="vx-brand-mark" aria-hidden="true"><Shield size={21} strokeWidth={2} /><span /></span>
      <span>Vision<strong>Guard</strong><i>.</i></span>
    </Link>
  );
}

export function Landing() {
  const [lens, setLens] = useState<Lens>('observe');
  const [playing, setPlaying] = useState(false);
  const [videoIssue, setVideoIssue] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const selected = lenses.find(item => item.id === lens) ?? lenses[0];

  const toggleVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      setVideoIssue(false);
      void video.play().catch(() => {
        setPlaying(false);
        setVideoIssue(true);
      });
    } else {
      video.pause();
    }
  };

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.vx-landing');
    if (!root || !('IntersectionObserver' in window)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const blocks = root.querySelectorAll<HTMLElement>('[data-reveal]');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('vx-inview');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: .08, rootMargin: '0px 0px -35px 0px' });
    blocks.forEach(block => observer.observe(block));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="vx-landing">
      <a className="vx-skip" href="#main-content">Skip to content</a>
      <header className="vx-header">
        <nav className="vx-wrap vx-nav" aria-label="Main navigation">
          <Brand />
          <div className="vx-nav-links">
            <a href="#experience">The experience</a>
            <a href="#capabilities">Capabilities</a>
            <a href="#workflow">How it works</a>
          </div>
          <div className="vx-nav-actions">
            <Link to="/login" className="vx-nav-signin">Sign in</Link>
            <Link to="/register" className="vx-button vx-button-dark vx-button-sm">
              Enter VisionGuard <ArrowUpRight size={16} />
            </Link>
          </div>
          <button
            type="button"
            className="vx-mobile-trigger"
            aria-expanded={mobileOpen}
            aria-controls="vx-mobile-nav"
            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
            onClick={() => setMobileOpen(state => !state)}
          >
            {mobileOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </nav>
        {mobileOpen && (
          <div id="vx-mobile-nav" className="vx-mobile-nav">
            <a href="#experience" onClick={() => setMobileOpen(false)}>The experience <ChevronRight size={17} /></a>
            <a href="#capabilities" onClick={() => setMobileOpen(false)}>Capabilities <ChevronRight size={17} /></a>
            <a href="#workflow" onClick={() => setMobileOpen(false)}>How it works <ChevronRight size={17} /></a>
            <Link to="/login" onClick={() => setMobileOpen(false)}>Sign in <ChevronRight size={17} /></Link>
            <Link to="/register" className="vx-mobile-cta" onClick={() => setMobileOpen(false)}>Enter VisionGuard <ArrowUpRight size={17} /></Link>
          </div>
        )}
      </header>

      <main id="main-content">
        <section className="vx-hero">
          <div className="vx-hero-topography" aria-hidden="true" />
          <div className="vx-wrap">
            <div className="vx-hero-editorial">
              <div className="vx-hero-serial"><span className="vx-serial-dot" /> VISUAL INTELLIGENCE FOR THE ROAD <span>VG—01 / 2026</span></div>
              <div className="vx-hero-grid">
                <div className="vx-hero-copy" data-reveal>
                  <h1>See beyond<br /><em>the traffic.</em></h1>
                  <p>Traffic footage tells a story.<br />VisionGuard helps you read it.</p>
                </div>
                <div className="vx-hero-aside" data-reveal>
                  <span className="vx-aside-star"><Sparkles size={24} strokeWidth={1.3} /></span>
                  <p>From the first frame to the bigger picture. Analyze vehicle movement, explore connected insights, and keep what matters in one workspace.</p>
                  <div className="vx-hero-buttons">
                    <Link to="/register" className="vx-button vx-button-dark vx-button-lg">Start exploring <ArrowUpRight size={18} /></Link>
                    <a href="#experience" className="vx-hero-text-link">Discover the platform <ArrowRight size={16} /></a>
                  </div>
                </div>
              </div>
              <div className="vx-hero-bottomline">
                <span><Check size={15} /> Browser-based analysis</span>
                <span><Check size={15} /> Video upload is your choice</span>
                <a href="#experience">EXPLORE BELOW <ArrowDownRight size={17} /></a>
              </div>
            </div>

            <div id="experience" className="vx-experience" data-reveal>
              <div className="vx-experience-head">
                <div className="vx-experience-kicker"><span className="vx-signal" /> THE VISIONGUARD EXPERIENCE</div>
                <span className="vx-experience-reference">01 / OBSERVE · CONNECT · UNDERSTAND</span>
              </div>
              <div className="vx-experience-grid">
                <div className="vx-video-area">
                  <div className="vx-video-heading"><span><Video size={15} /> TRAFFIC FOOTAGE / SAMPLE</span><span>VIDEO SOURCE</span></div>
                  <div className="vx-video-viewport">
                    <video
                      ref={videoRef}
                      src="/car-detection.mp4"
                      poster="/traffic_monitoring_corridor.jpg"
                      preload="none"
                      muted
                      playsInline
                      loop
                      aria-label="Sample traffic footage. No live AI inference is running in this landing-page preview."
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                      onError={() => { setPlaying(false); setVideoIssue(true); }}
                    />
                    <div className="vx-video-soft-mask" aria-hidden="true" />
                    <div className="vx-viewport-frame" aria-hidden="true"><span /><span /><span /><span /></div>
                    <div className="vx-viewport-label"><span /> SAMPLE FOOTAGE — NOT LIVE DETECTIONS</div>
                    <button type="button" className={'vx-video-toggle' + (playing ? ' vx-video-toggle-playing' : '')} onClick={toggleVideo} aria-label={playing ? 'Pause sample traffic footage' : 'Play sample traffic footage'}>
                      {playing ? <Pause size={25} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
                    </button>
                    {videoIssue && <div className="vx-video-error" role="status">Sample video could not play in this browser.</div>}
                  </div>
                  <div className="vx-video-footer"><span><CirclePlay size={15} /> Sample footage · Play to explore</span><span>NO TRACKS OR SPEEDS ARE GENERATED IN THIS PREVIEW</span></div>
                </div>

                <div className="vx-lens-panel">
                  <div className="vx-lens-overline">THREE WAYS TO SEE THE ROAD</div>
                  <div className="vx-lens-options" role="group" aria-label="Explore the VisionGuard analysis workflow">
                    {lenses.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className={'vx-lens-option' + (lens === item.id ? ' vx-lens-option-active' : '')}
                        aria-pressed={lens === item.id}
                        onClick={() => setLens(item.id)}
                      >
                        <span className="vx-lens-number">{item.n}</span>
                        <span className="vx-lens-name">{item.label}</span>
                        <ArrowUpRight size={17} />
                      </button>
                    ))}
                  </div>
                  <div className="vx-lens-detail" aria-live="polite">
                    <span>{selected.n} / {selected.label.toUpperCase()}</span>
                    <h2>{selected.title}</h2>
                    <p>{selected.explanation}</p>
                  </div>
                  <Link to="/register" className="vx-lens-link">Open the actual workspace <ArrowUpRight size={17} /></Link>
                </div>
              </div>
            </div>
            <div className="vx-after-experience">
              <div><span>POWERED BY</span><strong>YOLO11s</strong><i /> <strong>ONNX Runtime Web</strong><i /><strong>Optical tracking</strong></div>
              <span>BUILT FOR REVIEWABLE TRAFFIC INSIGHT</span>
            </div>
          </div>
        </section>

        <section className="vx-manifesto">
          <div className="vx-wrap vx-manifesto-grid">
            <div className="vx-section-index" data-reveal><span>01</span><span>THE IDEA</span></div>
            <div className="vx-manifesto-copy" data-reveal>
              <h2>Not more footage.<br /><span>More meaning.</span></h2>
              <p>There is a difference between watching movement and understanding it. VisionGuard puts vehicle detection, visual tracking, session history, and review into a connected experience.</p>
              <div className="vx-manifesto-rail">
                <div><span>01 / INPUT</span><strong>What happened?</strong></div>
                <ArrowRight size={19} />
                <div><span>02 / ANALYSIS</span><strong>What can we observe?</strong></div>
                <ArrowRight size={19} />
                <div><span>03 / REVIEW</span><strong>What does it mean?</strong></div>
              </div>
            </div>
          </div>
        </section>

        <section id="capabilities" className="vx-capabilities">
          <div className="vx-wrap">
            <div className="vx-section-topline"><span>02 / THE TOOLKIT</span><span>ONE CONNECTED WORKSPACE</span></div>
            <div className="vx-capabilities-heading" data-reveal>
              <h2>Intelligence in<br /><em>every layer.</em></h2>
              <p>From visual observations to useful information, each part of the experience has a purpose.</p>
            </div>
            <div className="vx-capability-list">
              {capabilities.map(({ number, icon: Icon, name, title, copy, detail }) => (
                <article className="vx-capability" key={number} data-reveal>
                  <div className="vx-capability-number">{number}</div>
                  <div className="vx-capability-symbol"><Icon size={26} strokeWidth={1.55} /></div>
                  <div className="vx-capability-main"><span>{name.toUpperCase()}</span><h3>{title}</h3></div>
                  <p>{copy}</p>
                  <div className="vx-capability-end"><span>{detail}</span><ArrowUpRight size={23} /></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="vx-showcase">
          <div className="vx-wrap">
            <div className="vx-showcase-title" data-reveal>
              <div><span className="vx-section-index-inline">03 / THE WORKSPACE</span><h2>One place for<br /><em>the entire picture.</em></h2></div>
              <p>Analysis doesn't end when playback does. Keep sessions and their related insights accessible from the same account workspace.</p>
            </div>
            <div className="vx-showcase-visual" data-reveal>
              <div className="vx-showcase-marks"><span>PRODUCT / WORKSPACE</span><span>VISIONGUARD — INTERFACE</span></div>
              <div className="vx-showcase-image">
                <div className="vx-showcase-window"><span /><span /><span /><b>APPLICATION PREVIEW</b></div>
                <img src="/platform_preview.png" alt="Preview of the VisionGuard application interface" loading="lazy" />
              </div>
              <div className="vx-showcase-note"><Layers3 size={22} /><div><strong>Bring the pieces together.</strong><span>Analysis · Activity history · Analytics · Review</span></div></div>
            </div>
          </div>
        </section>

        <section id="workflow" className="vx-workflow">
          <div className="vx-wrap">
            <div className="vx-section-topline"><span>04 / HOW IT WORKS</span><span>FROM VIDEO TO CONTEXT</span></div>
            <div className="vx-workflow-header" data-reveal>
              <h2>Three moves.<br /><em>One clearer view.</em></h2>
              <p>Built to be approachable from your first recording—not another complicated monitoring console to learn.</p>
            </div>
            <div className="vx-workflow-grid">
              {workflow.map(({ count, title, copy, icon: Icon }) => (
                <article className="vx-workflow-step" key={count} data-reveal>
                  <div className="vx-step-marker"><span>{count}</span><span className="vx-step-icon"><Icon size={25} strokeWidth={1.5} /></span></div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="vx-trust">
          <div className="vx-wrap vx-trust-grid">
            <div className="vx-trust-left" data-reveal>
              <div className="vx-section-index-inline">05 / BUILT ON CLARITY</div>
              <h2>Good intelligence<br />knows its <em>limits.</em></h2>
              <p>Powerful tools should explain what they do, what they store, and what still needs a human eye.</p>
              <div className="vx-trust-art" aria-hidden="true"><div className="vx-trust-ring vx-trust-ring-a" /><div className="vx-trust-ring vx-trust-ring-b" /><div className="vx-trust-ring vx-trust-ring-c" /><ShieldCheck size={40} strokeWidth={1.25} /><span>ANALYZE RESPONSIBLY</span></div>
            </div>
            <div className="vx-trust-rows">
              <div className="vx-trust-row" data-reveal><div><LockKeyhole size={22} /></div><section><h3>Your footage stays yours.</h3><p>Supported analysis runs in the browser. Keeping original footage on your device is optional, while cloud backup requires explicit upload and configured storage.</p></section><span>01</span></div>
              <div className="vx-trust-row" data-reveal><div><Activity size={22} /></div><section><h3>Measurements need perspective.</h3><p>Image-derived speed values are approximations—not calibrated road-speed measurements or proof of violations.</p></section><span>02</span></div>
              <div className="vx-trust-row" data-reveal><div><ShieldCheck size={22} /></div><section><h3>People make the final call.</h3><p>Detection and incident indicators support human review, not automated legal or enforcement decisions.</p></section><span>03</span></div>
            </div>
          </div>
        </section>

        <section className="vx-final">
          <div className="vx-wrap">
            <div className="vx-final-panel" data-reveal>
              <div className="vx-final-decoration" aria-hidden="true"><ScanLine size={180} strokeWidth={.6} /></div>
              <span>YOUR NEXT PERSPECTIVE STARTS HERE</span>
              <h2>See the road<br /><em>differently.</em></h2>
              <p>Transform everyday footage into visual observations and connected insights—with a workspace built around clarity.</p>
              <div className="vx-final-actions">
                <Link to="/register" className="vx-button vx-button-dark vx-button-lg">Enter VisionGuard <MoveUpRight size={19} /></Link>
                <Link to="/login">Already have an account? Sign in <ArrowRight size={17} /></Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="vx-footer">
        <div className="vx-wrap">
          <div className="vx-footer-top"><div><Brand footer /><p>Intelligence for the road ahead.</p></div><div className="vx-footer-links"><a href="#experience">Experience</a><a href="#capabilities">Capabilities</a><a href="#workflow">Workflow</a><Link to="/login">Sign in</Link></div></div>
          <div className="vx-footer-wordmark" aria-hidden="true">VISIONGUARD<span>.</span></div>
          <div className="vx-footer-bottom"><span>© {new Date().getFullYear()} VisionGuard. All rights reserved.</span><span><ShieldCheck size={15} /> Analysis is assistive. Review is essential.</span></div>
        </div>
      </footer>
    </div>
  );
}
