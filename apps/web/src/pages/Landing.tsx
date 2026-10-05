import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { 
  Shield, 
  Activity, 
  Camera, 
  Layers, 
  BarChart3, 
  CheckCircle2, 
  ChevronRight, 
  Video, 
  AlertTriangle, 
  ChevronDown,
  LineChart,
  Eye,
  Server,
  Menu,
  X
} from 'lucide-react';

// Reusable Scroll Reveal Component (Triggers Once)
const FadeInSection = ({ children, delay = 0, className = "" }: { children: React.ReactNode, delay?: number, className?: string }) => {
  const [isVisible, setVisible] = useState(false);
  const domRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setVisible(true);
          if (domRef.current) observer.unobserve(domRef.current);
        }
      });
    }, { threshold: 0.1 });
    
    if (domRef.current) observer.observe(domRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={domRef}
      className={`transition-all duration-[600ms] ease-out will-change-[opacity,transform] ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[20px]'
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

export function Landing() {
  const [activeSection, setActiveSection] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);

      // Scrollspy
      const sections = ['solutions', 'platform', 'features', 'technology', 'use-cases', 'about', 'faq'];
      let current = '';
      for (const section of sections) {
        const el = document.getElementById(section);
        if (el && window.scrollY >= el.offsetTop - 150) {
          current = section;
        }
      }
      setActiveSection(current);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const navLinks = [
    { id: 'solutions', label: 'Solutions' },
    { id: 'features', label: 'Features' },
    { id: 'technology', label: 'Technology' },
    { id: 'use-cases', label: 'Use Cases' },
    { id: 'about', label: 'About' }
  ];

  return (
    <div className="flex flex-col min-h-screen bg-white text-gray-900 font-sans selection:bg-gray-200">
      
      {/* Navbar */}
      <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-white/85 backdrop-blur-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border-b border-gray-200/50 h-14' : 'bg-white/80 backdrop-blur-sm border-b border-transparent h-16'
      }`}>
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 rounded-md" 
            onClick={(e) => scrollToSection(e as any, 'hero')} 
            tabIndex={0}
            aria-label="Go to top"
          >
            <Shield className="w-6 h-6 text-gray-900" />
            <span className="font-semibold text-lg tracking-tight text-gray-900">VisionGuard</span>
          </div>
          
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600" aria-label="Main Navigation">
            {navLinks.map((section) => (
              <a 
                key={section.id}
                href={`#${section.id}`} 
                onClick={(e) => scrollToSection(e, section.id)}
                className={`relative py-1 transition-colors cursor-pointer hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm ${activeSection === section.id ? 'text-gray-900' : ''}`}
              >
                {section.label}
                <span className={`absolute bottom-0 left-0 w-full h-[2px] bg-gray-900 transition-transform origin-left duration-300 ease-out ${
                  activeSection === section.id ? 'scale-x-100' : 'scale-x-0'
                }`} />
              </a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-4">
            <Link to="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm px-2 py-1">
              Login
            </Link>
            <Link to="/app" className="text-sm font-medium bg-gray-900 text-white px-4 py-2 rounded-md hover:bg-gray-800 transition-transform active:scale-95 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2">
              Enter Control Room
            </Link>
          </div>

          {/* Mobile Menu Toggle */}
          <button 
            className="md:hidden p-2 text-gray-600 focus:outline-none"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle mobile menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Nav */}
        <div className={`md:hidden absolute top-full left-0 right-0 bg-white border-b border-gray-200 transition-all duration-300 shadow-lg overflow-hidden ${
          mobileMenuOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}>
          <nav className="flex flex-col p-4">
            {navLinks.map((section) => (
              <a 
                key={section.id}
                href={`#${section.id}`} 
                onClick={(e) => scrollToSection(e, section.id)}
                className={`py-3 px-4 font-medium border-l-2 transition-colors ${
                  activeSection === section.id ? 'border-gray-900 text-gray-900 bg-gray-50' : 'border-transparent text-gray-600 hover:bg-gray-50'
                }`}
              >
                {section.label}
              </a>
            ))}
            <div className="flex flex-col gap-3 mt-4 px-4 pt-4 border-t border-gray-100">
              <Link to="/login" className="py-2 text-center font-medium text-gray-700 bg-gray-100 rounded-md">
                Login
              </Link>
              <Link to="/app" className="py-2 text-center font-medium bg-gray-900 text-white rounded-md">
                Enter Control Room
              </Link>
            </div>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section id="hero" className="relative pt-24 pb-16 lg:pt-32 lg:pb-20 overflow-hidden bg-slate-50">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <FadeInSection>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900 max-w-4xl mx-auto leading-tight mb-6 mt-8">
              AI-Powered Traffic Intelligence for Safer and Smarter Road Networks
            </h1>
          </FadeInSection>
          <FadeInSection delay={100}>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-10 leading-relaxed">
              Monitor traffic activity, analyze roadway conditions, detect operational events, and generate actionable insights through a browser-based intelligence platform.
            </p>
          </FadeInSection>
          
          <FadeInSection delay={200}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
              <Link to="/app" className="w-full sm:w-auto text-base font-medium bg-gray-900 text-white px-8 py-3 rounded-md hover:bg-gray-800 transition-all active:scale-95 shadow-sm flex items-center justify-center gap-2 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2">
                Enter Control Room <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <a href="#platform" onClick={(e) => scrollToSection(e, 'platform')} className="w-full sm:w-auto text-base font-medium bg-white text-gray-900 border border-gray-200 px-8 py-3 rounded-md hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-95 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2">
                Explore Platform
              </a>
            </div>
            
            {/* Trust Indicators */}
            <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-3 mb-16 text-sm font-medium text-gray-600">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-gray-400" /> Browser-Based Platform</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-gray-400" /> Real-Time Monitoring</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-gray-400" /> Multi-Camera Support</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-gray-400" /> Operational Analytics</span>
            </div>
          </FadeInSection>

          {/* Professional Composite Visual */}
          <FadeInSection delay={300}>
            <div className="relative max-w-5xl mx-auto transition-transform hover:-translate-y-1 duration-500">
              <div className="absolute inset-0 bg-gray-200 rounded-xl blur-xl opacity-40 transform translate-y-6"></div>
              <div className="relative rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden ring-1 ring-gray-900/5 flex flex-col">
                <div className="h-10 border-b border-gray-100 bg-gray-50 flex items-center px-4 gap-2">
                  <div className="w-3 h-3 rounded-full bg-gray-300"></div>
                  <div className="w-3 h-3 rounded-full bg-gray-300"></div>
                  <div className="w-3 h-3 rounded-full bg-gray-300"></div>
                </div>
                <img 
                  src="/dashboard_hero.png" 
                  alt="VisionGuard Traffic Monitoring Composite" 
                  className="w-full h-auto object-cover border-t border-gray-50"
                />
              </div>
            </div>
          </FadeInSection>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-24 bg-white border-b border-gray-100" id="solutions">
        <div className="max-w-7xl mx-auto px-6">
          <FadeInSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl font-bold text-gray-900">Built for Modern Traffic Operations</h2>
            </div>
          </FadeInSection>
          <div className="grid md:grid-cols-3 gap-8">
            <FadeInSection delay={100}>
              <div 
                className="p-8 border border-gray-200 rounded-xl hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-[6px] hover:border-gray-300 transition-all duration-250 ease-out cursor-pointer h-full group bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                tabIndex={0}
              >
                <div className="w-12 h-12 bg-slate-50 border border-gray-100 rounded-lg flex items-center justify-center mb-6 transition-transform duration-250 ease-out group-hover:scale-[1.05]">
                  <Eye className="w-6 h-6 text-gray-700 group-hover:text-gray-900 transition-colors" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3 cursor-pointer">Traffic Monitoring</h3>
                <p className="text-gray-600 leading-relaxed cursor-pointer">Centralized visibility across multiple traffic camera feeds.</p>
              </div>
            </FadeInSection>
            
            <FadeInSection delay={200}>
              <div 
                className="p-8 border border-gray-200 rounded-xl hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-[6px] hover:border-gray-300 transition-all duration-250 ease-out cursor-pointer h-full group bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                tabIndex={0}
              >
                <div className="w-12 h-12 bg-slate-50 border border-gray-100 rounded-lg flex items-center justify-center mb-6 transition-transform duration-250 ease-out group-hover:scale-[1.05]">
                  <LineChart className="w-6 h-6 text-gray-700 group-hover:text-gray-900 transition-colors" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3 cursor-pointer">Operational Analytics</h3>
                <p className="text-gray-600 leading-relaxed cursor-pointer">Analyze roadway activity and historical traffic trends.</p>
              </div>
            </FadeInSection>

            <FadeInSection delay={300}>
              <div 
                className="p-8 border border-gray-200 rounded-xl hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-[6px] hover:border-gray-300 transition-all duration-250 ease-out cursor-pointer h-full group bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                tabIndex={0}
              >
                <div className="w-12 h-12 bg-slate-50 border border-gray-100 rounded-lg flex items-center justify-center mb-6 transition-transform duration-250 ease-out group-hover:scale-[1.05]">
                  <AlertTriangle className="w-6 h-6 text-gray-700 group-hover:text-gray-900 transition-colors" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3 cursor-pointer">Event Awareness</h3>
                <p className="text-gray-600 leading-relaxed cursor-pointer">Identify unusual traffic conditions and operational events.</p>
              </div>
            </FadeInSection>
          </div>
        </div>
      </section>

      {/* Platform Overview Section */}
      <section className="py-24 bg-slate-50" id="platform">
        <div className="max-w-7xl mx-auto px-6">
          <FadeInSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">One Platform for Traffic Visibility and Analysis</h2>
            </div>
          </FadeInSection>

          <div className="flex flex-col lg:flex-row items-center gap-16">
            <div className="flex-1 w-full relative">
              <FadeInSection delay={150}>
                <div className="absolute inset-0 bg-gray-200 rounded-xl transform -translate-x-4 translate-y-4 -z-10 opacity-50"></div>
                <div className="rounded-xl border border-gray-200 shadow-xl overflow-hidden transition-all duration-300 hover:shadow-2xl bg-white">
                  <div className="h-8 border-b border-gray-100 bg-gray-50 flex items-center px-4 gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-gray-300"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-gray-300"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-gray-300"></div>
                  </div>
                  <img 
                    src="/platform_preview.png" 
                    alt="VisionGuard Platform Overview" 
                    className="w-full h-auto object-cover"
                  />
                </div>
              </FadeInSection>
            </div>

            <div className="flex-1">
              <div className="space-y-8">
                {[
                  { icon: Camera, title: 'Camera Management', desc: 'Organize and monitor multiple traffic camera sources.' },
                  { icon: Eye, title: 'Live Monitoring', desc: 'View roadway activity through a centralized interface.' },
                  { icon: BarChart3, title: 'Analytics', desc: 'Track traffic volumes and operational metrics.' },
                  { icon: Layers, title: 'Reporting', desc: 'Review historical insights and trends.' }
                ].map((item, idx) => (
                  <FadeInSection key={idx} delay={idx * 50}>
                    <div className="flex gap-4">
                      <div className="w-10 h-10 rounded-lg bg-white border border-gray-200 shadow-sm flex items-center justify-center flex-shrink-0">
                        <item.icon className="w-5 h-5 text-gray-700" />
                      </div>
                      <div>
                        <h4 className="text-lg font-semibold text-gray-900 mb-1">{item.title}</h4>
                        <p className="text-gray-600">{item.desc}</p>
                      </div>
                    </div>
                  </FadeInSection>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 bg-white border-y border-gray-200" id="features">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { icon: Video, title: 'Multi-Camera Monitoring', desc: 'Manage multiple traffic streams from one dashboard.' },
              { icon: BarChart3, title: 'Traffic Analytics', desc: 'Analyze traffic volume and roadway activity.' },
              { icon: AlertTriangle, title: 'Event Detection', desc: 'Surface operational incidents and unusual conditions.' },
              { icon: Layers, title: 'Centralized Operations', desc: 'Unify monitoring workflows in one platform.' },
              { icon: Activity, title: 'Historical Insights', desc: 'Review trends and long-term performance.' },
              { icon: Server, title: 'Scalable Deployment', desc: 'Support expansion across multiple locations.' }
            ].map((feat, idx) => (
              <FadeInSection key={idx} delay={idx * 50}>
                <div 
                  className="bg-white p-8 rounded-xl border border-gray-200 shadow-sm transition-all duration-250 ease-out hover:-translate-y-[6px] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:border-gray-300 group cursor-pointer h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                  tabIndex={0}
                  aria-label={feat.title}
                >
                  <div className="w-12 h-12 bg-slate-50 border border-gray-100 rounded-lg flex items-center justify-center mb-6 transition-transform duration-250 ease-out group-hover:scale-[1.05]">
                    <feat.icon className="w-6 h-6 text-gray-700 transition-colors duration-250 group-hover:text-gray-900" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-3 transition-colors duration-250 cursor-pointer">{feat.title}</h3>
                  <p className="text-gray-600 leading-relaxed cursor-pointer">
                    {feat.desc}
                  </p>
                </div>
              </FadeInSection>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works (Timeline) */}
      <section className="py-24 bg-slate-50 border-b border-gray-200" id="technology">
        <div className="max-w-7xl mx-auto px-6">
          <FadeInSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">From Camera Feed to Operational Insight</h2>
            </div>
          </FadeInSection>

          <div className="grid md:grid-cols-4 gap-8 relative">
            {/* Connecting Line */}
            <div className="hidden md:block absolute top-6 left-12 right-12 h-px bg-gray-300 z-0"></div>
            
            {[
              { title: 'Connect Cameras' },
              { title: 'Monitor Activity' },
              { title: 'Analyze Data' },
              { title: 'Generate Insights' }
            ].map((step, idx) => (
              <FadeInSection key={idx} delay={idx * 100}>
                <div className="relative z-10 pt-4 md:pt-0 group cursor-pointer h-full flex flex-col items-center md:items-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-lg p-2 md:p-0" tabIndex={0}>
                  <div className="w-12 h-12 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center font-bold text-gray-600 mb-6 transition-all duration-250 ease-out group-hover:scale-[1.05] group-hover:shadow-[0_4px_12px_rgb(0,0,0,0.05)] group-hover:border-gray-400 group-hover:text-gray-900 cursor-pointer">
                    {idx + 1}
                  </div>
                  <h3 className="text-lg font-bold text-gray-600 transition-colors duration-250 group-hover:text-gray-900 text-center md:text-left cursor-pointer">{step.title}</h3>
                </div>
              </FadeInSection>
            ))}
          </div>
        </div>
      </section>

      {/* Dashboard Showcase */}
      <section className="py-24 bg-white" id="showcase">
        <div className="max-w-7xl mx-auto px-6">
          <FadeInSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">Operational Visibility at a Glance</h2>
            </div>
          </FadeInSection>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <FadeInSection delay={100}>
              <div 
                className="p-6 border border-gray-200 rounded-xl bg-slate-50 shadow-sm cursor-pointer hover:shadow-md hover:border-gray-300 transition-all duration-250 group hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                tabIndex={0}
              >
                <div className="text-sm font-medium text-gray-500 mb-2 cursor-pointer">Total Vehicle Count</div>
                <div className="text-3xl font-bold text-gray-900 group-hover:text-black transition-colors cursor-pointer">45,102</div>
              </div>
            </FadeInSection>
            <FadeInSection delay={200}>
              <div 
                className="p-6 border border-gray-200 rounded-xl bg-slate-50 shadow-sm cursor-pointer hover:shadow-md hover:border-gray-300 transition-all duration-250 group hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                tabIndex={0}
              >
                <div className="text-sm font-medium text-gray-500 mb-2 cursor-pointer">Average Flow Speed</div>
                <div className="text-3xl font-bold text-gray-900 group-hover:text-black transition-colors cursor-pointer">52 mph</div>
              </div>
            </FadeInSection>
            <FadeInSection delay={300}>
              <div 
                className="p-6 border border-gray-200 rounded-xl bg-slate-50 shadow-sm cursor-pointer hover:shadow-md hover:border-gray-300 transition-all duration-250 group hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                tabIndex={0}
              >
                <div className="text-sm font-medium text-gray-500 mb-2 cursor-pointer">Active Camera Feeds</div>
                <div className="text-3xl font-bold text-gray-900 group-hover:text-black transition-colors cursor-pointer">124</div>
              </div>
            </FadeInSection>
          </div>
          
          <FadeInSection delay={400}>
             <div className="relative rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden transition-all duration-300 hover:shadow-2xl">
                <div className="h-8 border-b border-gray-100 bg-gray-50 flex items-center px-4 gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-300"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-300"></div>
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-300"></div>
                </div>
                <img 
                  src="/platform_preview.png" 
                  alt="VisionGuard Interface" 
                  className="w-full h-auto object-cover"
                />
              </div>
          </FadeInSection>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-24 bg-slate-50 border-y border-gray-200" id="use-cases">
        <div className="max-w-7xl mx-auto px-6">
          <FadeInSection>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">Designed for Real-World Transportation Operations</h2>
            </div>
          </FadeInSection>

          <div className="grid md:grid-cols-2 gap-6">
            {[
              { title: 'Transportation Authorities', desc: 'Monitor roadway conditions across regions.' },
              { title: 'Traffic Operations Centers', desc: 'Centralized traffic visibility and analytics.' },
              { title: 'Smart Cities', desc: 'Support data-driven infrastructure decisions.' },
              { title: 'Campuses and Facilities', desc: 'Monitor internal transportation networks.' }
            ].map((uc, idx) => (
              <FadeInSection key={idx} delay={idx * 100}>
                <div 
                  className="p-8 border border-gray-200 rounded-xl transition-all duration-250 ease-out hover:border-gray-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-[6px] cursor-pointer h-full bg-white group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                  tabIndex={0}
                >
                  <h3 className="text-lg font-semibold text-gray-900 mb-2 group-hover:text-black transition-colors cursor-pointer">{uc.title}</h3>
                  <p className="text-gray-600 cursor-pointer">{uc.desc}</p>
                </div>
              </FadeInSection>
            ))}
          </div>
        </div>
      </section>

      {/* About Section */}
      <section className="py-24 bg-white" id="about">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            <div className="flex-1">
              <FadeInSection>
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">Why VisionGuard?</h2>
                <p className="text-lg text-gray-600 leading-relaxed mb-6">
                  VisionGuard provides modern traffic intelligence and operational visibility through a browser-based platform designed for transportation teams, infrastructure operators, and smart city initiatives.
                </p>
                <p className="text-lg text-gray-600 leading-relaxed">
                  By centralizing camera management and analytics into a single interface, we enable teams to respond faster, plan more effectively, and maintain comprehensive situational awareness without relying on outdated software.
                </p>
              </FadeInSection>
            </div>
            
            <div className="flex-1 w-full relative">
              <FadeInSection delay={150}>
                <div className="relative rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden ring-1 ring-gray-900/5">
                  <img 
                    src="/dashboard_hero.png" 
                    alt="VisionGuard Operations" 
                    className="w-full h-auto object-cover"
                  />
                </div>
              </FadeInSection>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 bg-slate-50 border-t border-gray-200" id="faq">
        <div className="max-w-3xl mx-auto px-6">
          <FadeInSection>
            <h2 className="text-3xl font-bold text-gray-900 mb-12 text-center">Frequently Asked Questions</h2>
          </FadeInSection>
          <div className="space-y-4">
            {[
              { q: 'What types of cameras are supported?', a: 'VisionGuard supports common IP cameras and standardized video streams including HLS, RTSP, and relayed broadcasts.' },
              { q: 'Is VisionGuard browser-based?', a: 'Yes. The entire platform, including monitoring and configuration, is accessible through a modern web browser.' },
              { q: 'Can it scale across multiple locations?', a: 'Yes. The architecture supports multi-location deployments and centralized monitoring workflows.' },
              { q: 'What analytics capabilities are available?', a: 'VisionGuard provides metrics on traffic volume, flow speed, vehicle classification, and historical trend reporting.' },
              { q: 'Who can use VisionGuard?', a: 'The platform is built for transportation authorities, municipal governments, traffic operations centers, and facility operators.' }
            ].map((faq, idx) => {
              const isOpen = openFaq === idx;
              return (
                <FadeInSection key={idx} delay={idx * 50}>
                  <div className="border border-gray-200 rounded-lg bg-white overflow-hidden transition-colors hover:border-gray-300">
                    <button 
                      onClick={() => setOpenFaq(isOpen ? null : idx)}
                      className="w-full text-left px-6 py-4 flex items-center justify-between focus:outline-none focus:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900 group cursor-pointer"
                      aria-expanded={isOpen}
                      aria-controls={`faq-answer-${idx}`}
                      id={`faq-question-${idx}`}
                    >
                      <h3 className="text-lg font-medium text-gray-900 cursor-pointer group-hover:text-black transition-colors">{faq.q}</h3>
                      <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform duration-300 ease-out cursor-pointer group-hover:text-gray-900 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    <div 
                      id={`faq-answer-${idx}`}
                      role="region"
                      aria-labelledby={`faq-question-${idx}`}
                      className={`transition-all duration-300 ease-in-out cursor-pointer ${
                        isOpen ? 'max-h-40 opacity-100 pb-4' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <p className="text-gray-600 px-6 cursor-pointer leading-relaxed">{faq.a}</p>
                    </div>
                  </div>
                </FadeInSection>
              );
            })}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-white border-t border-gray-200 text-center">
        <div className="max-w-3xl mx-auto px-6">
          <FadeInSection>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">Ready to Explore VisionGuard?</h2>
            <p className="text-xl text-gray-600 mb-10 leading-relaxed">
              Access the platform and experience a modern approach to traffic monitoring and operational visibility.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link to="/app" className="text-base font-medium bg-gray-900 text-white px-8 py-3 rounded-md hover:bg-gray-800 transition-all active:scale-95 shadow-sm group flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2">
                Enter Control Room <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <button className="text-base font-medium bg-white text-gray-900 border border-gray-200 px-8 py-3 rounded-md hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-95 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2">
                Contact Team
              </button>
            </div>
          </FadeInSection>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-50 border-t border-gray-200 py-16">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-6 gap-8">
          <div className="col-span-2">
            <div className="flex items-center gap-2 mb-6 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm w-fit" onClick={(e) => scrollToSection(e as any, 'hero')} tabIndex={0}>
              <Shield className="w-5 h-5 text-gray-900" />
              <span className="font-semibold text-gray-900">VisionGuard</span>
            </div>
            <p className="text-sm text-gray-500 max-w-xs cursor-pointer">
              Traffic intelligence and operational visibility for modern transportation environments.
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold text-gray-900 mb-4 cursor-pointer">Solutions</h4>
            <ul className="space-y-3 text-sm text-gray-600">
              <li><a href="#platform" onClick={(e) => scrollToSection(e, 'platform')} className="hover:text-gray-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm">Traffic Monitoring</a></li>
              <li><a href="#platform" onClick={(e) => scrollToSection(e, 'platform')} className="hover:text-gray-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm">Analytics</a></li>
              <li><a href="#platform" onClick={(e) => scrollToSection(e, 'platform')} className="hover:text-gray-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm">Event Detection</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-gray-900 mb-4 cursor-pointer">Features</h4>
            <ul className="space-y-3 text-sm text-gray-600">
              <li><a href="#features" onClick={(e) => scrollToSection(e, 'features')} className="hover:text-gray-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm">Camera Management</a></li>
              <li><a href="#showcase" onClick={(e) => scrollToSection(e, 'showcase')} className="hover:text-gray-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm">Dashboards</a></li>
              <li><a href="#use-cases" onClick={(e) => scrollToSection(e, 'use-cases')} className="hover:text-gray-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm">Use Cases</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-gray-900 mb-4 cursor-pointer">Resources</h4>
            <ul className="space-y-3 text-sm text-gray-600">
              <li><a href="#faq" onClick={(e) => scrollToSection(e, 'faq')} className="hover:text-gray-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm">FAQ</a></li>
              <li><a href="#technology" onClick={(e) => scrollToSection(e, 'technology')} className="hover:text-gray-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm">Technology</a></li>
              <li><span className="text-gray-400 cursor-pointer">Support</span></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-gray-900 mb-4 cursor-pointer">Company</h4>
            <ul className="space-y-3 text-sm text-gray-600">
              <li><a href="#about" onClick={(e) => scrollToSection(e, 'about')} className="hover:text-gray-900 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 rounded-sm">About</a></li>
              <li><span className="text-gray-400 cursor-pointer">Privacy Policy</span></li>
              <li><span className="text-gray-400 cursor-pointer">Terms of Service</span></li>
            </ul>
          </div>
        </div>
        
        <div className="max-w-7xl mx-auto px-6 mt-16 pt-8 border-t border-gray-200 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500 cursor-pointer">© 2026 VisionGuard AI. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
