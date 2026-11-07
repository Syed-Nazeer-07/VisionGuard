import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, Database, Film, LockKeyhole, Shield, Video, ScanSearch, FileText, CloudUpload } from 'lucide-react';

const stages = [
  {
    number: '01', icon: Film, title: 'Select your footage',
    description: 'Upload a local recording, open your camera, or approve capture of a live browser tab. Analysis starts alongside playback.'
  },
  {
    number: '02', icon: ScanSearch, title: 'Detect and track',
    description: 'YOLO11s and optical tracking identify road users across frames, with classes and approximate motion estimates.'
  },
  {
    number: '03', icon: FileText, title: 'Review and report',
    description: 'Track activity appears across the overview, analytics, history, incidents and exportable reports under your account.'
  }
];
const capabilities = [
  { icon: Video, title: 'Live visual analysis', detail: 'Browser-side video inference with boxes and persistent track IDs.' },
  { icon: BarChart3, title: 'Connected insights', detail: 'Session counts and vehicle classes backed by the same activity records.' },
  { icon: Database, title: 'Saved analysis history', detail: 'Local-first tracking records with authenticated metadata synchronization.' },
  { icon: CloudUpload, title: 'Optional video storage', detail: 'Original files are uploaded to Backblaze B2 only when you choose to save them.' }
];

export function Landing() {
  return <div className="min-h-screen bg-white text-[#18283d] antialiased">
    <header className="sticky top-0 z-40 border-b border-[#e7ecf1] bg-white/95 backdrop-blur-lg">
      <nav className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-5 px-5 sm:px-8" aria-label="Main navigation">
        <Link to="/" className="flex items-center gap-2.5 text-[17px] font-bold tracking-[-.035em]">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#1b365c] text-white">
            <Shield size={19} strokeWidth={1.8}/>
          </span>
          VisionGuard
        </Link>
        <div className="hidden items-center gap-7 text-[13px] font-medium text-slate-600 md:flex">
          <a href="#workflow" className="hover:text-[#2356a8]">Workflow</a>
          <a href="#capabilities" className="hover:text-[#2356a8]">Capabilities</a>
          <a href="#architecture" className="hover:text-[#2356a8]">Architecture</a>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="hidden text-sm font-semibold text-slate-700 hover:text-[#2356a8] sm:inline">Sign in</Link>
          <Link to="/register" className="vg-primary">Get started <ArrowRight size={15}/></Link>
        </div>
      </nav>
    </header>

    <main>
      <section className="overflow-hidden bg-[#f6f8fb]">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[.95fr_1.05fr] lg:gap-16 lg:py-28">
          <div>
            <p className="mb-5 text-xs font-semibold uppercase tracking-[.16em] text-[#42658d]">Video analysis / Vehicle tracking</p>
            <h1 className="max-w-[690px] text-[clamp(2.5rem,5vw,4.6rem)] font-semibold leading-[1.08] tracking-[-.055em] text-[#17283e]">
              Traffic footage, turned into useful information.
            </h1>
            <p className="mt-6 max-w-[540px] text-base leading-8 text-[#607085]">
              Analyze video and live tab captures with YOLO11s. Review vehicle tracks, keep session history, and generate reports from one workspace.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className="vg-primary min-h-11 px-5">Create an account <ArrowRight size={16}/></Link>
              <Link to="/login" className="vg-secondary min-h-11 px-5">Open workspace</Link>
            </div>
            <p className="mt-6 text-xs leading-5 text-slate-500">
              Local analysis available. Video cloud storage is optional. Source accuracy depends on the model and footage.
            </p>
          </div>
          <div className="min-w-0 overflow-hidden rounded-2xl border border-[#dce4ed] bg-white p-2 shadow-[0_25px_65px_-35px_rgba(22,43,74,.38)] sm:p-3">
            <div className="flex items-center justify-between px-2 pb-3 pt-1">
              <span className="text-xs font-semibold text-[#33475e]">Traffic video analysis</span>
              <span className="text-[11px] text-slate-400">Illustrative footage</span>
            </div>
            <img src="/traffic_monitoring_corridor.jpg" alt="Road traffic captured from an elevated observation point"
              className="aspect-[16/10] w-full rounded-xl object-cover" loading="eager"/>
            <div className="flex flex-wrap items-center gap-2 px-2 pb-1 pt-3 text-[11px] font-medium text-[#5e7086]">
              <span>YOLO11s · ONNX Runtime Web</span>
              <span aria-hidden="true">·</span>
              <span>Local-first tracking</span>
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="scroll-mt-24 border-b border-[#e8edf3] py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#42658d]">The workflow</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">From video to structured activity</h2>
            <p className="mt-4 text-sm leading-7 text-slate-600">A simple path from the original footage to records you can inspect later.</p>
          </div>
          <div className="mt-11 grid gap-4 md:grid-cols-3">
            {stages.map(item => {
              const Icon = item.icon;
              return <article key={item.number} className="rounded-xl border border-[#e3e9ef] p-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">{item.number}</span>
                  <Icon size={20} className="text-[#315a8b]"/>
                </div>
                <h3 className="mt-8 text-base font-semibold text-[#18283d]">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-600">{item.description}</p>
              </article>;
            })}
          </div>
        </div>
      </section>

      <section id="capabilities" className="scroll-mt-24 bg-[#fafbfd] py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#42658d]">One workspace</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">Tools that work together</h2>
          </div>
          <div className="mt-11 grid gap-4 sm:grid-cols-2">
            {capabilities.map(item=>{
              const Icon=item.icon;
              return <article key={item.title} className="flex gap-4 rounded-xl border border-[#e3e9ef] bg-white p-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#ebf1f8] text-[#315a8b]">
                  <Icon size={20}/>
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-[#1b2e45]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">{item.detail}</p>
                </div>
              </article>;
            })}
          </div>
        </div>
      </section>

      <section id="architecture" className="scroll-mt-24 border-t border-[#e8edf3] py-20 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#42658d]">Architecture</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">Built with clear data boundaries</h2>
            <p className="mt-5 text-sm leading-8 text-slate-600">
              VisionGuard keeps analysis processing separate from account metadata and original video files.
              The web app can process supported video locally, while authenticated accounts allow session history to synchronize.
            </p>
            <Link to="/register" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-[#2356a8] hover:underline">
              Try the workspace <ArrowRight size={16}/>
            </Link>
          </div>
          <div className="space-y-4">
            <div className="flex gap-3 border-b border-[#e7edf3] pb-4">
              <ScanSearch size={20} className="mt-1 shrink-0 text-[#315a8b]"/>
              <div><h3 className="text-sm font-semibold">Analysis in your browser</h3>
                <p className="mt-1.5 text-sm leading-7 text-slate-600">YOLO11s inference with WebGPU where compatible and a WebAssembly fallback.</p></div>
            </div>
            <div className="flex gap-3 border-b border-[#e7edf3] pb-4">
              <LockKeyhole size={20} className="mt-1 shrink-0 text-[#315a8b]"/>
              <div><h3 className="text-sm font-semibold">Authentication and structured records</h3>
                <p className="mt-1.5 text-sm leading-7 text-slate-600">Supabase Auth and PostgreSQL store account-owned metadata, session summaries and review flags.</p></div>
            </div>
            <div className="flex gap-3 pb-4">
              <CloudUpload size={20} className="mt-1 shrink-0 text-[#315a8b]"/>
              <div><h3 className="text-sm font-semibold">Video storage only when requested</h3>
                <p className="mt-1.5 text-sm leading-7 text-slate-600">Original uploaded videos can be retained on your device or explicitly saved to Backblaze B2.</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#182c46] px-5 py-16 text-white sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-.03em]">Start with your own footage.</h2>
            <p className="mt-2 max-w-xl text-sm leading-7 text-slate-300">
              Reviewable data, without pretending that uncalibrated speed estimates are legally verified offences.
            </p>
          </div>
          <Link to="/register" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-[#182c46] hover:bg-slate-100">
            Create account <ArrowRight size={16}/>
          </Link>
        </div>
      </section>
    </main>
    <footer className="border-t border-[#e8edf3] py-7">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 text-xs text-slate-500 sm:px-8">
        <span className="flex items-center gap-2 font-semibold text-[#263950]"><Shield size={15}/> VisionGuard</span>
        <span>Traffic analytics · Review before enforcement</span>
        <Link to="/login" className="hover:text-[#2356a8]">Sign in</Link>
      </div>
    </footer>
  </div>;
}
