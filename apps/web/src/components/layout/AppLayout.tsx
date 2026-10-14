import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from '../ErrorBoundary'
import { 
  LayoutDashboard, 
  ShieldAlert, 
  BarChart3, 
  FileText, 
  Settings,
  Users,
  ClipboardCheck,
  Bell,
  FolderSearch,
  Activity,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Shield,
  UserCog,
  FileKey,
  Clock,
  LineChart,
  Film
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../store/auth'
import { supabase } from '../../lib/supabase'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

// Primary visible navigation items (4 primary destinations)
const PRIMARY_NAV = [
  { name: 'Dashboard', path: '/app', icon: LayoutDashboard, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
  { name: 'Live Analysis', path: '/app/analyze', icon: Activity, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
  { name: 'History', path: '/app/videos', icon: Clock, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
  { name: 'Cases', path: '/app/cases', icon: FolderSearch, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
]

// Secondary operations and tools grouped under "More"
const SECONDARY_NAV = [
  { name: 'Analytics', path: '/app/analytics', icon: BarChart3, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
  { name: 'Reports', path: '/app/reports', icon: FileText, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
]

const ADMIN_NAV = [
  { name: 'User Management', path: '/app/users', icon: Users, roles: ['Admin'] },
  { name: 'System Config', path: '/app/config', icon: UserCog, roles: ['Admin'] },
  { name: 'Audit Logs', path: '/app/audit', icon: FileKey, roles: ['Admin'] },
]

const ALL_NAV = [
  ...PRIMARY_NAV,
  ...SECONDARY_NAV,
  ...ADMIN_NAV,
  { name: 'Settings', path: '/app/settings', icon: Settings, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
]

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, role } = useAuthStore()
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Check if current page is in secondary or admin nav to keep "More" open
  const isSecondaryActive = SECONDARY_NAV.some(item => location.pathname === item.path) || ADMIN_NAV.some(item => location.pathname === item.path)
  const [isMoreOpen, setIsMoreOpen] = useState(isSecondaryActive)

  useEffect(() => {
    if (isSecondaryActive) {
      setIsMoreOpen(true)
    }
  }, [isSecondaryActive])

  // Default to Viewer if no role is set
  const currentRole = role || 'Viewer'

  const filteredPrimaryNav = PRIMARY_NAV.filter(item => item.roles.includes(currentRole))
  const filteredSecondaryNav = SECONDARY_NAV.filter(item => item.roles.includes(currentRole))
  const filteredAdminNav = ADMIN_NAV.filter(item => item.roles.includes(currentRole))

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  // Find current page title
  const currentNav = ALL_NAV.find(i => i.path === location.pathname)
  const pageTitle = currentNav?.name || 'Dashboard'

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-slate-900 overflow-hidden font-sans">
      
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isCollapsed ? 80 : 260 }}
        className="flex-shrink-0 bg-white border-r border-slate-200 flex flex-col relative z-20 shadow-sm"
      >
        {/* Collapse Toggle */}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-6 bg-white border border-slate-200 rounded-full p-1 shadow-sm hover:bg-slate-50 transition-colors z-30 text-slate-400 hover:text-slate-600 cursor-pointer"
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>

        {/* Logo Area */}
        <div className="h-[72px] flex items-center px-6 border-b border-slate-100 shrink-0">
          <Link to="/app" className="flex items-center space-x-3 group outline-none overflow-hidden whitespace-nowrap">
            <div className="bg-slate-900 p-1.5 rounded-lg flex-shrink-0">
              <Shield className="w-5 h-5 text-white" />
            </div>
            {!isCollapsed && (
              <motion.span 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-lg font-bold text-slate-900 tracking-tight"
              >
                VisionGuard
              </motion.span>
            )}
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-5 px-3 space-y-1 scrollbar-hide">
          {/* Primary Top 5 Navigation Destinations */}
          {filteredPrimaryNav.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.name}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-[14px] font-medium outline-none overflow-hidden whitespace-nowrap",
                  isActive 
                    ? "bg-blue-50 text-blue-700 shadow-sm shadow-blue-100/50 font-semibold" 
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                )}
                title={isCollapsed ? item.name : undefined}
              >
                <item.icon className={cn("w-5 h-5 shrink-0", isActive ? "text-blue-600" : "text-slate-400")} />
                {!isCollapsed && <span>{item.name}</span>}
              </Link>
            )
          })}

          {/* Grouped Secondary & Admin Items under "More" */}
          {!isCollapsed ? (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setIsMoreOpen(prev => !prev)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <span>More</span>
                  {isSecondaryActive && !isMoreOpen && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                  )}
                </span>
                {isMoreOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
              </button>

              {isMoreOpen && (
                <div className="space-y-0.5 mt-1 pl-1 border-l-2 border-slate-100 ml-2">
                  {filteredSecondaryNav.map((item) => {
                    const isActive = location.pathname === item.path
                    return (
                      <Link
                        key={item.name}
                        to={item.path}
                        className={cn(
                          "flex items-center gap-2.5 px-3 py-1.5 rounded-md transition-all text-[13px] font-medium outline-none overflow-hidden whitespace-nowrap",
                          isActive 
                            ? "bg-blue-50 text-blue-700 font-semibold shadow-2xs" 
                            : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                        )}
                      >
                        <item.icon className={cn("w-4 h-4 shrink-0", isActive ? "text-blue-600" : "text-slate-400")} />
                        <span>{item.name}</span>
                      </Link>
                    )
                  })}

                  {filteredAdminNav.length > 0 && (
                    <div className="pt-2">
                      <div className="px-3 py-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                        Administration
                      </div>
                      {filteredAdminNav.map((item) => {
                        const isActive = location.pathname === item.path
                        return (
                          <Link
                            key={item.name}
                            to={item.path}
                            className={cn(
                              "flex items-center gap-2.5 px-3 py-1.5 rounded-md transition-all text-[13px] font-medium outline-none overflow-hidden whitespace-nowrap",
                              isActive 
                                ? "bg-slate-100 text-slate-900 font-semibold shadow-2xs" 
                                : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                            )}
                          >
                            <item.icon className={cn("w-4 h-4 shrink-0", isActive ? "text-slate-800" : "text-slate-400")} />
                            <span>{item.name}</span>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Collapsed sidebar view: icons separated by small divider */
            <div className="pt-2">
              <div className="my-2 border-t border-slate-100" />
              {filteredSecondaryNav.map((item) => {
                const isActive = location.pathname === item.path
                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    className={cn(
                      "flex items-center justify-center p-2 rounded-lg transition-all outline-none",
                      isActive 
                        ? "bg-blue-50 text-blue-700 shadow-sm" 
                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                    )}
                    title={item.name}
                  >
                    <item.icon className={cn("w-5 h-5", isActive ? "text-blue-600" : "text-slate-400")} />
                  </Link>
                )
              })}
              {filteredAdminNav.length > 0 && (
                <>
                  <div className="my-2 border-t border-slate-100" />
                  {filteredAdminNav.map((item) => {
                    const isActive = location.pathname === item.path
                    return (
                      <Link
                        key={item.name}
                        to={item.path}
                        className={cn(
                          "flex items-center justify-center p-2 rounded-lg transition-all outline-none",
                          isActive 
                            ? "bg-slate-100 text-slate-900 shadow-sm" 
                            : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                        )}
                        title={item.name}
                      >
                        <item.icon className={cn("w-5 h-5", isActive ? "text-slate-800" : "text-slate-400")} />
                      </Link>
                    )
                  })}
                </>
              )}
            </div>
          )}
        </nav>

        {/* User Profile Card */}
        <div className="p-3 border-t border-slate-100 bg-slate-50/50 shrink-0">
          <div className={cn(
            "flex items-center gap-2.5 bg-white border border-slate-200 rounded-xl shadow-sm transition-all overflow-hidden",
            isCollapsed ? "p-2 flex-col items-center justify-center gap-1.5" : "p-2.5"
          )}>
            {!isCollapsed ? (
              <>
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[13px] shrink-0 uppercase" title={user?.email || 'User'}>
                  {user?.email?.charAt(0) || 'U'}
                </div>
                <div className="flex-1 min-w-0 pr-1">
                  <div className="font-semibold text-slate-900 text-[13px] truncate leading-tight" title={user?.user_metadata?.full_name || user?.email || 'User'}>
                    {user?.user_metadata?.full_name || user?.email || 'User'}
                  </div>
                  <div className="text-[11px] text-slate-500 font-medium mt-0.5 truncate uppercase tracking-wide">
                    {currentRole}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Link 
                    to="/app/settings" 
                    className={cn(
                      "transition-colors p-1.5 rounded-lg shrink-0 outline-none cursor-pointer",
                      location.pathname === '/app/settings' 
                        ? "text-blue-600 bg-blue-50 font-semibold" 
                        : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    )}
                    title="Settings"
                    aria-label="Settings"
                  >
                    <Settings className="w-[18px] h-[18px]" />
                  </Link>
                  <button 
                    onClick={handleLogout} 
                    className="text-slate-400 hover:text-red-600 transition-colors p-1.5 hover:bg-red-50 rounded-lg shrink-0 outline-none cursor-pointer" 
                    title="Logout"
                    aria-label="Sign out"
                  >
                    <LogOut className="w-[18px] h-[18px]" />
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-1.5 w-full">
                <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[13px] shrink-0 uppercase" title={user?.email || 'User'}>
                  {user?.email?.charAt(0) || 'U'}
                </div>
                <div className="w-full border-t border-slate-100 my-0.5" />
                <Link 
                  to="/app/settings" 
                  className={cn(
                    "transition-colors p-1.5 rounded-lg shrink-0 outline-none flex items-center justify-center cursor-pointer",
                    location.pathname === '/app/settings' 
                      ? "text-blue-600 bg-blue-50 font-semibold" 
                      : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                  )}
                  title="Settings"
                  aria-label="Settings"
                >
                  <Settings className="w-[18px] h-[18px]" />
                </Link>
                <button 
                  onClick={handleLogout} 
                  className="text-slate-400 hover:text-red-600 transition-colors p-1.5 hover:bg-red-50 rounded-lg shrink-0 outline-none cursor-pointer flex items-center justify-center" 
                  title="Logout"
                  aria-label="Sign out"
                >
                  <LogOut className="w-[18px] h-[18px]" />
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative min-w-0 overflow-x-hidden">
        
        {/* Global App Header */}
        <header className="h-[72px] bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 lg:px-8 shrink-0 z-10 relative shadow-sm shadow-slate-100/50">
          
          <div className="flex items-center min-w-0">
            <h1 className="text-[18px] sm:text-[20px] font-bold text-slate-900 tracking-tight truncate">
              {pageTitle}
            </h1>
          </div>

          <div className="flex items-center space-x-3 sm:space-x-4">
            {/* Notifications / Pending Review Queue */}
            <Link 
              to="/app/cases?tab=review"
              className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors outline-none shrink-0"
              title="Prioritized Review Queue"
            >
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 border-2 border-white rounded-full"></span>
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden bg-[#F8FAFC] p-4 sm:p-6 lg:p-8 min-w-0">
          <div className="w-full max-w-[1700px] mx-auto min-w-0">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </div>
      </main>
    </div>
  )
}
