
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { 
  LayoutDashboard, 
  MonitorPlay, 
  FileVideo, 
  Camera, 
  ShieldAlert, 
  BarChart3, 
  FileText, 
  BellRing, 
  Settings,
  Users,
  LogOut,
  ClipboardCheck
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAuthStore } from '../../store/auth'
import { supabase } from '../../lib/supabase'

const navItems = [
  { name: 'Dashboard', path: '/app', icon: LayoutDashboard },
  { name: 'Live Monitor', path: '/app/monitor', icon: MonitorPlay },
  { name: 'Analyze Video', path: '/app/analyze', icon: FileVideo },
  { name: 'Cameras', path: '/app/cameras', icon: Camera },
  { name: 'Violations', path: '/app/violations', icon: ShieldAlert },
  { name: 'Review Queue', path: '/app/review-queue', icon: ClipboardCheck },
  { name: 'Analytics', path: '/app/analytics', icon: BarChart3 },
  { name: 'Reports', path: '/app/reports', icon: FileText },
  { name: 'Alerts', path: '/app/alerts', icon: BellRing },
  { name: 'Admin', path: '/app/admin', icon: Users },
  { name: 'Settings', path: '/app/settings', icon: Settings },
]

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, role } = useAuthStore()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-800">
          <Link to="/" className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-500 bg-clip-text text-transparent">
            VisionGuard
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.name}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium",
                  isActive 
                    ? "bg-indigo-600/10 text-indigo-400" 
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                )}
              >
                <item.icon className={cn("w-5 h-5", isActive ? "text-indigo-400" : "text-gray-500")} />
                {item.name}
              </Link>
            )
          })}
        </nav>
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-3 px-3 py-2 text-sm text-gray-400">
            <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center font-bold text-white uppercase">
              {user?.email?.charAt(0) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-white truncate">{user?.email || 'User'}</div>
              <div className="text-xs truncate">Role: {role || 'Viewer'}</div>
            </div>
            <button onClick={handleLogout} className="text-gray-500 hover:text-white transition-colors" title="Logout">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative">
        <header className="h-16 border-b border-gray-800 flex items-center px-8 bg-gray-950/50 backdrop-blur sticky top-0 z-10">
          <h2 className="text-lg font-semibold capitalize">
            {navItems.find(i => i.path === location.pathname)?.name || 'Dashboard'}
          </h2>
        </header>
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
