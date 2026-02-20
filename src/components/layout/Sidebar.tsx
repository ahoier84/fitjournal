import { NavLink } from 'react-router'
import { LayoutDashboard, Dumbbell, Calendar, TrendingUp, Upload, Settings, LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/workouts', label: 'Workouts', icon: Dumbbell },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/trends', label: 'Trends', icon: TrendingUp },
  { to: '/import', label: 'Import', icon: Upload },
  { to: '/settings', label: 'Settings', icon: Settings },
]

// Bottom tab bar items for mobile (Import accessible from Settings page)
const mobileNavItems = [
  { to: '/', label: 'Home', icon: LayoutDashboard },
  { to: '/workouts', label: 'Workouts', icon: Dumbbell },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/trends', label: 'Trends', icon: TrendingUp },
  { to: '/settings', label: 'More', icon: Settings },
]

export function Sidebar() {
  const { user, logout } = useAuth()

  return (
    <aside className="hidden md:flex w-64 bg-sidebar border-r border-border flex-col h-screen sticky top-0">
      <div className="p-6">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Dumbbell className="w-6 h-6 text-primary" />
          FitJournal
        </h1>
      </div>
      <nav className="flex-1 px-3">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-sidebar-foreground hover:bg-secondary'
              )
            }
          >
            <Icon className="w-5 h-5" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-border">
        {user && (
          <div className="flex items-center gap-3">
            {user.photoURL && (
              <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.displayName}</p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
            <button
              onClick={logout}
              className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground shrink-0"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

export function MobileBottomNav() {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-sidebar border-t border-border z-50 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-14">
        {mobileNavItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors min-w-0',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground'
              )
            }
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
