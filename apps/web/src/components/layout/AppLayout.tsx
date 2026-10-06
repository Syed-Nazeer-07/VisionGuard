import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { ErrorBoundary } from '../ErrorBoundary'
import { 
  LayoutDashboard, 
  MonitorPlay, 
  ShieldAlert, 
  BarChart3, 
  FileText, 
  Settings,
  Users,
  ClipboardCheck,
  Bell,
  Search,
  FolderSearch,
  Activity,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Shield,
  UserCog,
  FileKey,
  Camera,
  LineChart
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../store/auth'
import { supabase } from '../../lib/supabase'
import { useState } from 'react'
import { motion } from 'framer-motion'

// Define all possible navigation items
const MAIN_NAV = [
  { name: 'Dashboard', path: '/app', icon: LayoutDashboard, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
  { name: 'Camera Assets', path: '/app/cameras', icon: Camera, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
  { name: 'Video Library', path: '/app/videos', icon: FolderSearch, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
  { name: 'Live Monitoring', path: '/app/monitor', icon: MonitorPlay, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
  { name: 'Live Analysis', path: '/app/analyze', icon: Activity, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
  { name: 'Incident Center', path: '/app/incidents', icon: ShieldAlert, roles: ['Operator', 'Supervisor', 'Admin'] },
  { name: 'Cases', path: '/app/cases', icon: FolderSearch, roles: ['Operator', 'Supervisor', 'Admin'] },
  { name: 'Review Queue', path: '/app/review-queue', icon: ClipboardCheck, roles: ['Supervisor', 'Admin'] },
  { name: 'Video Review', path: '/app/video-review', icon: ClipboardCheck, roles: ['Supervisor', 'Admin'] },
  { name: 'Analytics', path: '/app/analytics', icon: BarChart3, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
  { name: 'Executive Intelligence', path: '/app/executive', icon: LineChart, roles: ['Viewer', 'Supervisor', 'Admin'] },
  { name: 'Reports', path: '/app/reports', icon: FileText, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
  { name: 'Settings', path: '/app/settings', icon: Settings, roles: ['Viewer', 'Operator', 'Supervisor', 'Admin'] },
]

const ADMIN_NAV = [
  { name: 'User Management', path: '/app/users', icon: Users, roles: ['Admin'] },
  { name: 'System Config', path: '/app/config', icon: UserCog, roles: ['Admin'] },
  { name: 'Audit Logs', path: '/app/audit', icon: FileKey, roles: ['Admin'] },
]

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, role } = useAuthStore()
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Default to Viewer if no role is set
  const currentRole = role || 'Viewer'

  const filteredMainNav = MAIN_NAV.filter(item => item.roles.includes(currentRole))
  const filteredAdminNav = ADMIN_NAV.filter(item => item.roles.includes(currentRole))

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  // Find current page title
  const currentNav = [...MAIN_NAV, ...ADMIN_NAV].find(i => i.path === location.pathname)
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
          className="absolute -right-3 top-6 bg-white border border-slate-200 rounded-full p-1 shadow-sm hover:bg-slate-50 transition-colors z-30 text-slate-400 hover:text-slate-600"
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
        <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-1 scrollbar-hide">
          {filteredMainNav.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.name}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-[14px] font-medium outline-none overflow-hidden whitespace-nowrap",
                  isActive 
                    ? "bg-blue-50 text-blue-700 shadow-sm shadow-blue-100/50" 
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                )}
                title={isCollapsed ? item.name : undefined}
              >
                <item.icon className={cn("w-5 h-5 shrink-0", isActive ? "text-blue-600" : "text-slate-400")} />
                {!isCollapsed && <span>{item.name}</span>}
              </Link>
            )
          })}

          {filteredAdminNav.length > 0 && (
            <div className="pt-6 pb-2">
              {!isCollapsed && (
                <div className="px-3 mb-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                  Administration
                </div>
              )}
              {filteredAdminNav.map((item) => {
                const isActive = location.pathname === item.path
                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-[14px] font-medium outline-none overflow-hidden whitespace-nowrap mt-1",
                      isActive 
                        ? "bg-slate-100 text-slate-900 shadow-sm" 
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    )}
                    title={isCollapsed ? item.name : undefined}
                  >
                    <item.icon className={cn("w-5 h-5 shrink-0", isActive ? "text-slate-800" : "text-slate-400")} />
                    {!isCollapsed && <span>{item.name}</span>}
                  </Link>
                )
              })}
            </div>
          )}
        </nav>

        {/* User Profile Card */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50">
          <div className={cn(
            "flex items-center gap-3 bg-white border border-slate-200 rounded-xl shadow-sm transition-all overflow-hidden",
            isCollapsed ? "p-2 justify-center" : "p-3"
          )}>
            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[13px] shrink-0 uppercase">
              {user?.email?.charAt(0) || 'U'}
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0 pr-2">
                <div className="font-semibold text-slate-900 text-[13px] truncate leading-tight">
                  {user?.user_metadata?.full_name || user?.email || 'User'}
                </div>
                <div className="text-[11px] text-slate-500 font-medium mt-0.5 truncate uppercase tracking-wide">
                  {currentRole}
                </div>
              </div>
            )}
            {!isCollapsed && (
              <button 
                onClick={handleLogout} 
                className="text-slate-400 hover:text-red-600 transition-colors p-1.5 hover:bg-red-50 rounded-lg shrink-0" 
                title="Logout"
              >
                <LogOut className="w-[18px] h-[18px]" />
              </button>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative min-w-0">
        
        {/* Global App Header */}
        <header className="h-[72px] bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 z-10 relative shadow-sm shadow-slate-100/50">
          
          <div className="flex items-center">
            <h1 className="text-[20px] font-bold text-slate-900 tracking-tight">
              {pageTitle}
            </h1>
          </div>

          <div className="flex items-center space-x-6">
            
            {/* Global Search */}
            <div className="relative hidden md:block">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input 
                type="text" 
                placeholder="Search cameras, incidents..." 
                className="w-64 pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[13px] text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>

            <div className="h-6 w-px bg-slate-200 hidden md:block"></div>

            {/* System Status */}
            <div className="flex items-center space-x-2 bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </div>
              <span className="text-[12px] font-semibold text-green-700 uppercase tracking-wide">System Healthy</span>
            </div>

            {/* Notifications */}
            <button className="relative p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors outline-none">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 border-2 border-white rounded-full"></span>
            </button>

          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto bg-[#F8FAFC] p-8">
          <div className="max-w-[1400px] mx-auto">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </div>
      </main>
    </div>
  )
}
