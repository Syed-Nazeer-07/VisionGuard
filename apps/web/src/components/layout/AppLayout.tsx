import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BarChart3, Clock3, FileKey, FileText, FolderSearch,
  LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen,
  Settings, Shield, UserCog, Users, X
} from 'lucide-react';
import RealtimeAnalyze from '../../pages/RealtimeAnalyze';
import { ErrorBoundary } from '../ErrorBoundary';
import { useAuthStore } from '../../store/auth';
import { supabase } from '../../lib/supabase';

const EVERYONE = ['Viewer', 'Operator', 'Supervisor', 'Admin'];
const PRIMARY_NAV = [
  { label: 'Overview', to: '/app', icon: LayoutDashboard, roles: EVERYONE },
  { label: 'Live analysis', to: '/app/analyze', icon: Activity, roles: EVERYONE },
  { label: 'History', to: '/app/videos', icon: Clock3, roles: EVERYONE },
  { label: 'Incidents', to: '/app/cases', icon: FolderSearch, roles: EVERYONE },
];
const DATA_NAV = [
  { label: 'Analytics', to: '/app/analytics', icon: BarChart3, roles: EVERYONE },
  { label: 'Reports', to: '/app/reports', icon: FileText, roles: EVERYONE },
];
const ADMIN_NAV = [
  { label: 'Users', to: '/app/users', icon: Users, roles: ['Admin'] },
  { label: 'System configuration', to: '/app/config', icon: UserCog, roles: ['Admin'] },
  { label: 'Audit log', to: '/app/audit', icon: FileKey, roles: ['Admin'] },
];

type NavItem = (typeof PRIMARY_NAV)[number];
const NAV = [...PRIMARY_NAV, ...DATA_NAV, ...ADMIN_NAV];
const MODERN_PATHS = new Set(['/app', '/app/analyze', '/app/videos',
  '/app/cases', '/app/analytics', '/app/reports']);

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tabSharing, setTabSharing] = useState(false);
  const currentRole = role || 'Viewer';
  const activeAnalyze = location.pathname === '/app/analyze';
  const page = NAV.find(item => item.to === location.pathname);
  const title = page?.label || (location.pathname.includes('settings') ? 'Settings' : 'Workspace');
  const displayName = (user?.user_metadata?.full_name as string | undefined) || user?.email || 'Member';
  const initial = displayName.trim().slice(0, 1).toUpperCase() || 'U';

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{active: boolean}>).detail;
      setTabSharing(!!detail?.active);
    };
    window.addEventListener('visionguard:tab-capture-status', onStatus);
    return () => window.removeEventListener('visionguard:tab-capture-status', onStatus);
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  const menuGroup = (label: string, items: NavItem[]) => {
    const visible = items.filter(item => item.roles.includes(currentRole));
    if (!visible.length) return null;
    return <section className="mb-5">
      {!collapsed && <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.13em] text-slate-400">{label}</div>}
      <div className="space-y-1">
        {visible.map(item => {
          const active = location.pathname === item.to;
          const Icon = item.icon;
          return <Link key={item.to} to={item.to} title={collapsed ? item.label : undefined}
            aria-current={active ? 'page' : undefined}
            onClick={() => setMobileOpen(false)}
            className={'flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors ' +
              (collapsed ? 'justify-center ' : '') +
              (active
                ? 'bg-[#e9f1fb] font-semibold text-[#1d4f8b]'
                : 'font-medium text-[#57677c] hover:bg-[#eef2f7] hover:text-slate-900')}>
            <Icon size={18} strokeWidth={active ? 2.15 : 1.8} className="shrink-0"/>
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>;
        })}
      </div>
    </section>;
  };

  return <div className="vg-shell flex h-screen overflow-hidden bg-[#f6f8fa] text-slate-900">
    {mobileOpen && <button type="button" aria-label="Close navigation"
      className="fixed inset-0 z-30 bg-slate-950/35 md:hidden"
      onClick={() => setMobileOpen(false)} />}
    <aside
      className={'fixed inset-y-0 left-0 z-40 flex w-[248px] shrink-0 flex-col border-r border-[#e1e7ee] bg-[#fbfcfe] transition-[width,transform] duration-200 md:relative md:translate-x-0 ' +
        (collapsed ? 'md:w-[78px] ' : 'md:w-[248px] ') +
        (mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex h-[66px] shrink-0 items-center justify-between border-b border-[#e9edf2] px-4">
        <Link to="/app" onClick={() => setMobileOpen(false)}
          className={'flex min-w-0 items-center gap-2.5 ' + (collapsed ? 'mx-auto' : '')}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#1b365c] text-white">
            <Shield size={19} strokeWidth={1.8}/>
          </span>
          {!collapsed && <span className="truncate text-[16px] font-bold tracking-[-.035em] text-[#18283d]">VisionGuard</span>}
        </Link>
        <button type="button" aria-label="Close menu"
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 md:hidden"
          onClick={() => setMobileOpen(false)}><X size={18}/></button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-5" aria-label="Workspace navigation">
        {menuGroup('Workspace', PRIMARY_NAV)}
        {menuGroup('Insights', DATA_NAV)}
        {menuGroup('Administration', ADMIN_NAV)}
      </nav>

      <div className="shrink-0 border-t border-[#e5eaf0] p-3">
        <Link to="/app/settings" onClick={() => setMobileOpen(false)}
          title={collapsed ? 'Settings' : undefined}
          className={'mb-2 flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium text-[#57677c] hover:bg-[#eef2f7] hover:text-slate-900 ' +
            (collapsed ? 'justify-center' : '')}>
          <Settings size={18} strokeWidth={1.8} className="shrink-0"/>
          {!collapsed && <span>Settings</span>}
        </Link>
        <div className={'flex items-center gap-2.5 rounded-lg border border-[#e5eaf0] bg-white p-2 ' +
          (collapsed ? 'flex-col' : '')}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eaf0f8] text-xs font-bold text-[#294b75]">{initial}</div>
          {!collapsed && <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-[#263950]" title={displayName}>{displayName}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{currentRole}</div>
          </div>}
          <button type="button" onClick={() => void signOut()} title="Sign out" aria-label="Sign out"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <LogOut size={17}/>
          </button>
        </div>
      </div>
    </aside>

    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-[66px] shrink-0 items-center justify-between gap-4 border-b border-[#e1e7ee] bg-white px-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" aria-label="Open navigation"
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden"
            onClick={() => setMobileOpen(true)}>
            <Menu size={20}/>
          </button>
          <button type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:inline-flex"
            onClick={() => setCollapsed(value => !value)}>
            {collapsed ? <PanelLeftOpen size={19}/> : <PanelLeftClose size={19}/>}
          </button>
          <div className="hidden h-5 w-px bg-slate-200 sm:block"/>
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-slate-400">VisionGuard / Workspace</div>
            <h1 className="truncate text-[15px] font-semibold tracking-[-.02em] text-[#1d2d44]">{title}</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {tabSharing && <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true"/>
            <span className="hidden text-xs font-medium text-amber-900 sm:inline">Tab sharing active</span>
            {!activeAnalyze && <Link to="/app/analyze" className="text-xs font-semibold text-[#2356a8] hover:underline">
              View
            </Link>}
            <button type="button" className="text-xs font-semibold text-amber-900 hover:underline"
              onClick={() => window.dispatchEvent(new Event('visionguard:stop-tab-capture'))}>
              Stop
            </button>
          </div>}
          {!tabSharing && <Link to="/app/videos"
            className="hidden rounded-lg border border-[#e0e6ed] bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 sm:block">
            View activity
          </Link>}
        </div>
      </header>
      <main className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto" id="main-content">
        <ErrorBoundary>
          {/* Retain the playback element/worker between app pages. */}
          <div style={activeAnalyze
            ? { display: 'block' }
            : { position: 'absolute', left: '-200vw', top: 0, width: '100%', visibility: 'hidden', pointerEvents: 'none' }}>
            <RealtimeAnalyze active={activeAnalyze}/>
          </div>
          {!activeAnalyze && <div className={MODERN_PATHS.has(location.pathname) ? '' : 'p-4 sm:p-6'}>
            <Outlet/>
          </div>}
        </ErrorBoundary>
      </main>
    </div>
  </div>;
}
