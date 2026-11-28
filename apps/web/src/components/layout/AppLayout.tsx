import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, BarChart3, Clock3, FileKey, FileText, FolderSearch,
  LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen,
  Settings, UserCog, Users, X
} from 'lucide-react';
import { ThemeControl } from '../theme/ThemeControl';
import { ErrorBoundary } from '../ErrorBoundary';
import { useAuthStore } from '../../store/auth';
import { supabase } from '../../lib/supabase';
import '../../styles/workspace.css';
import '../../styles/workspace-theme.css';
import '../../styles/workspace-responsive.css';
import '../../styles/product-experience.css';
import '../../styles/appearance.css';

// Load the inference workspace only after requested, but preserve its state
// once visited so playback and tab capture survive workspace navigation.
const RealtimeAnalyze = lazy(() => import('../../pages/RealtimeAnalyze'));

const EVERYONE = ['Viewer', 'Operator', 'Supervisor', 'Admin'];
const PRIMARY_NAV = [
  { label: 'Overview', to: '/app/overview', icon: LayoutDashboard, roles: EVERYONE },
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
const MODERN_PATHS = new Set(['/app', '/app/overview', '/app/analyze', '/app/videos',
  '/app/cases', '/app/analytics', '/app/reports', '/app/settings']);

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role, profile } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [smallViewport, setSmallViewport] = useState(
    () => window.matchMedia?.('(max-width: 1023px)').matches ?? false
  );
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  // A collapsed desktop rail must always expand when opened as a mobile drawer.
  const compactSidebar = collapsed && !mobileOpen;
  const [tabSharing, setTabSharing] = useState(false);
  const currentRole = role || 'Viewer';
  const activeAnalyze = location.pathname === '/app/analyze';
  const [analysisMounted, setAnalysisMounted] = useState(activeAnalyze);
  const route = location.pathname === '/app' ? '/app/overview' : location.pathname;
  const page = NAV.find(item => item.to === route);
  const title = page?.label || (location.pathname.includes('settings') ? 'Settings' : 'Workspace');
  const displayName = profile?.name || (user?.user_metadata?.full_name as string | undefined) || user?.email || 'Member';
  const initial = displayName.trim().slice(0, 1).toUpperCase() || 'U';

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1023px)');
    if (!media) return;
    const update = () => {
      setSmallViewport(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobileOpen || !smallViewport) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
      } else if (event.key === 'Tab') {
        const elements = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []).filter(element => element.getClientRects().length > 0);
        if (!elements.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || !sidebarRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !sidebarRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      menuButtonRef.current?.focus();
    };
  }, [mobileOpen, smallViewport]);
  useEffect(() => { if (activeAnalyze) setAnalysisMounted(true); }, [activeAnalyze]);
  useEffect(() => {
    const onStatus = (event: Event) => {
      const detail = (event as CustomEvent<{active: boolean}>).detail;
      setTabSharing(!!detail?.active);
    };
    window.addEventListener('visionguard:tab-capture-status', onStatus);
    return () => window.removeEventListener('visionguard:tab-capture-status', onStatus);
  }, []);

  const captureStatus = (compact = false) => <div className={"vg-capture-status" + (compact ? " vg-capture-compact" : "")} aria-label="Browser tab sharing is active">
    <span aria-hidden="true"/><Link to="/app/analyze" aria-label="Return to active tab sharing">{compact ? "Live" : "Tab sharing"}</Link>
    <button type="button" aria-label="Stop tab sharing" onClick={() => window.dispatchEvent(new Event("visionguard:stop-tab-capture"))}>Stop</button>
  </div>;

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  const menuGroup = (label: string, items: NavItem[]) => {
    const visible = items.filter(item => item.roles.includes(currentRole));
    if (!visible.length) return null;
    return <section className="mb-5 vg-side-group">
      {!compactSidebar && <div className="vg-side-group-label mb-2 px-3 uppercase">{label}</div>}
      <div className="space-y-1">
        {visible.map(item => {
          const active = route === item.to;
          const Icon = item.icon;
          return <Link key={item.to} to={item.to} title={compactSidebar ? item.label : undefined}
            aria-current={active ? 'page' : undefined}
            aria-label={item.label}
            onClick={() => setMobileOpen(false)}
            className={'vg-side-nav-item px-3 ' + (compactSidebar ? 'justify-center ' : '')}>
            <Icon size={18} strokeWidth={active ? 2.15 : 1.8} className="shrink-0"/>
            {!compactSidebar && <span className="truncate">{item.label}</span>}
          </Link>;
        })}
      </div>
    </section>;
  };

  return <div className="vg-shell flex h-dvh overflow-hidden">
    <a href="#main-content" className="vg-workspace-skip">Skip to workspace content</a>
    {mobileOpen && <button type="button" aria-label="Close navigation"
      className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden"
      onClick={() => setMobileOpen(false)} />}
    <aside ref={sidebarRef} id="vg-workspace-navigation" aria-label="Workspace navigation"
      role={mobileOpen && smallViewport ? 'dialog' : undefined}
      aria-modal={mobileOpen && smallViewport ? true : undefined}
      aria-hidden={smallViewport && !mobileOpen ? true : undefined}
      inert={smallViewport && !mobileOpen}
      className={'vg-side-bar fixed inset-y-0 left-0 z-40 flex w-[248px] shrink-0 flex-col border-r transition-[width,transform] duration-200 lg:relative lg:translate-x-0 ' +
        (compactSidebar ? 'lg:w-[78px] ' : 'lg:w-[248px] ') +
        (mobileOpen ? 'translate-x-0' : '-translate-x-full')}>
      <div className={"vg-side-head flex h-[72px] shrink-0 items-center border-b " + (compactSidebar ? "vg-side-head-compact justify-center" : "justify-between px-4")}>
        <Link to="/app" onClick={() => setMobileOpen(false)} aria-label="VisionGuard workspace"
          className={'vg-side-logo flex items-center gap-2.5 ' + (compactSidebar ? 'vg-side-logo-compact' : 'min-w-0')}>
          <img src="/brand-mark.svg?v=20261111" alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-[10px]" />
          {!compactSidebar && <span className="truncate text-[16px] font-bold tracking-[-.045em]">Vision<span className="font-medium">Guard</span><span className="vg-brand-dot">.</span></span>}
        </Link>
        <button ref={closeButtonRef} type="button" aria-label="Close menu"
          className="vg-side-icon-button rounded-lg p-1.5 lg:hidden"
          onClick={() => setMobileOpen(false)}><X size={18}/></button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-6" aria-label="Workspace navigation">
        {menuGroup('Workspace', PRIMARY_NAV)}
        {menuGroup('Insights', DATA_NAV)}
        {menuGroup('Administration', ADMIN_NAV)}
      </nav>

      <div className="vg-side-footer shrink-0 border-t p-3">
        {!smallViewport && <button type="button" aria-label={compactSidebar ? 'Expand sidebar' : 'Collapse sidebar'}
          title={compactSidebar ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!compactSidebar}
          className={"vg-side-nav-item vg-side-toggle mb-2 flex h-10 w-full items-center gap-3 rounded-lg px-3 " + (compactSidebar ? "justify-center" : "")}
          onClick={() => setCollapsed(value => !value)}>
          {compactSidebar ? <PanelLeftOpen size={18} className="shrink-0"/> : <PanelLeftClose size={18} className="shrink-0"/>}
          {!compactSidebar && <span>Collapse sidebar</span>}
        </button>}
        {!smallViewport && tabSharing && !activeAnalyze && <div className="vg-side-capture">{captureStatus(compactSidebar)}</div>}
        {!smallViewport && <div className={"vg-side-theme" + (compactSidebar ? " vg-side-theme-compact" : "")}>
          {!compactSidebar && <span>Appearance</span>}<ThemeControl/>
        </div>}
        <Link to="/app/settings" onClick={() => setMobileOpen(false)}
          aria-current={location.pathname === '/app/settings' ? 'page' : undefined}
          aria-label="Settings"
          title={compactSidebar ? 'Settings' : undefined}
          className={'vg-side-nav-item vg-side-settings mb-2 flex h-10 items-center gap-3 rounded-lg px-3 ' +
            (compactSidebar ? 'justify-center' : '')}>
          <Settings size={18} strokeWidth={1.8} className="shrink-0"/>
          {!compactSidebar && <span>Settings</span>}
        </Link>
        <div className={'vg-side-account flex items-center gap-2.5 rounded-lg p-2 ' +
          (compactSidebar ? 'flex-col' : '')}>
          <div className="vg-side-avatar h-8 w-8 shrink-0 rounded-full text-xs">{initial}</div>
          {!compactSidebar && <div className="min-w-0 flex-1">
            <div className="vg-side-account-name truncate text-xs font-semibold" title={displayName}>{displayName}</div>

          </div>}
          <button type="button" onClick={() => void signOut()} title="Sign out" aria-label="Sign out"
            className="vg-side-signout rounded-md p-1.5">
            <LogOut size={17}/>
          </button>
        </div>
      </div>
    </aside>

    <div className="flex min-w-0 flex-1 flex-col" inert={smallViewport && mobileOpen}>
      <div hidden={!smallViewport} className="vg-mobile-bar vg-product-topbar flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <button ref={menuButtonRef} type="button" aria-label="Open navigation"
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          aria-expanded={mobileOpen} aria-controls="vg-workspace-navigation"
          onClick={() => setMobileOpen(true)}><Menu size={20}/></button>
        <div className="vg-topbar-location min-w-0">
          <span className="vg-topbar-title truncate">{title}</span>
        </div>
        <div className="vg-topbar-actions ml-auto">
          {smallViewport && tabSharing && !activeAnalyze && captureStatus()}
          {smallViewport && <ThemeControl/>}
        </div>
      </div>
      <main tabIndex={-1} className="vg-main-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto" id="main-content">
        <ErrorBoundary>
          {/* Retain the playback element/worker between app pages. */}
          <div style={activeAnalyze
            ? { display: 'block' }
            : { position: 'absolute', left: '-200vw', top: 0, width: '100%', visibility: 'hidden', pointerEvents: 'none' }}>
            {/* Remount on account change so video, capture permissions, workers,
                and in-memory track IDs never carry into another user's session.
                The old component's cleanup does not delete retained files. */}
            {analysisMounted && <Suspense fallback={activeAnalyze
              ? <div role="status" className="vg-page py-8 text-sm text-slate-600">Preparing the analysis workspace…</div>
              : null}>
              <RealtimeAnalyze key={user?.id ?? 'signed-out'} active={activeAnalyze}/>
            </Suspense>}
          </div>
          {!activeAnalyze && <div className={MODERN_PATHS.has(location.pathname) ? '' : 'vg-admin-page p-4 sm:p-6'}>
            <Suspense fallback={<div role="status" className="vg-page text-sm text-[#687980]">Loading workspace page…</div>}>
              <Outlet/>
            </Suspense>
          </div>}
        </ErrorBoundary>
      </main>
    </div>
  </div>;
}
