import { Link } from 'react-router-dom';
import { Activity, ArrowRight, CheckCircle2, CloudUpload, FolderSearch, Gauge, ShieldCheck, Video, Zap } from 'lucide-react';

const steps = [
  {
    number: '01',
    title: 'Choose traffic footage',
    detail: 'Start with a short, clear MP4. You can test detection before saving anything.',
    icon: Video,
  },
  {
    number: '02',
    title: 'Run browser detection',
    detail: 'Detect and follow vehicles with YOLO. A separate Python server is optional.',
    icon: Zap,
  },
  {
    number: '03',
    title: 'Review measured results',
    detail: 'Check tracks and source frames. Real-world speed requires valid calibration.',
    icon: FolderSearch,
  },
];

export function FirstRunDashboard() {
  return (
    <div className="max-w-7xl mx-auto pb-12 space-y-7">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white p-7 sm:p-11 lg:p-14">
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none opacity-[0.13]"
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '28px 28px' }} />
        <div className="absolute -right-16 -top-24 w-80 h-80 rounded-full bg-indigo-500/20 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row justify-between gap-8 items-start">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-200 bg-white/10 border border-white/10 px-3 py-1.5 rounded-full mb-6">
              <Activity className="w-4 h-4" /> Operations workspace
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight leading-tight">
              Make traffic data actionable.
            </h1>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed mt-5 max-w-xl">
              Your workspace is ready. Start by inspecting a recording, then build a reliable history of vehicles and reviewed events.
            </p>
            <div className="flex flex-wrap gap-3 mt-8">
              <Link to="/app/analyze"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white hover:bg-indigo-50 text-slate-950 font-semibold text-sm transition">
                <CloudUpload className="w-4 h-4" /> Start analysis <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/app/videos"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-white font-medium text-sm transition">
                <FolderSearch className="w-4 h-4" /> Video history
              </Link>
            </div>
          </div>
          <div className="w-full lg:max-w-[250px] rounded-2xl border border-white/15 bg-white/5 backdrop-blur-sm p-5">
            <div className="flex items-center gap-2 text-indigo-200 text-xs font-semibold uppercase tracking-wider mb-4">
              <ShieldCheck className="w-4 h-4" /> First-run checklist
            </div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs text-slate-300">Getting started</span>
              <span className="text-sm font-semibold">0 / 3</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
              <div className="w-0 h-full bg-indigo-400 rounded-full" />
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mt-4">
              Start with browser analysis. Configure B2 storage only when you want to retain footage.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-indigo-600">Your workflow</p>
          <h2 className="text-xl sm:text-2xl tracking-tight font-bold text-slate-900 mt-2">Three steps to your first analysis</h2>
          <p className="text-sm text-slate-500 mt-1">A guided start without unnecessary configuration.</p>
        </div>
        <span className="text-xs text-slate-500">Nothing has been analyzed yet</span>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {steps.map(step => (
          <article key={step.number} className="rounded-2xl border border-slate-200 bg-white p-6 hover:border-indigo-200 hover:shadow-sm transition">
            <div className="flex items-center justify-between mb-6">
              <div className="h-11 w-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-700">
                <step.icon className="w-5 h-5" />
              </div>
              <span className="text-3xl font-semibold text-slate-200 tracking-tight">{step.number}</span>
            </div>
            <h3 className="font-semibold text-slate-900">{step.title}</h3>
            <p className="text-sm text-slate-500 leading-relaxed mt-2">{step.detail}</p>
          </article>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-4 justify-between sm:items-center rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex gap-3 items-start">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-white border border-slate-200 flex items-center justify-center">
            <Gauge className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">About vehicle speed</h3>
            <p className="text-xs text-slate-600 leading-relaxed mt-1 max-w-xl">
              Detection works without calibration. Measured km/h becomes available only after setting an accurate road-plane reference.
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
          <CheckCircle2 className="w-4 h-4 text-indigo-600" /> No fabricated speed estimates
        </div>
      </div>
    </div>
  );
}
