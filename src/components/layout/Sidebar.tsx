import { NavLink } from 'react-router'
import { LayoutDashboard, Dumbbell, Calendar, TrendingUp, Upload, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/workouts', label: 'Workouts', icon: Dumbbell },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
  { to: '/trends', label: 'Trends', icon: TrendingUp },
  { to: '/import', label: 'Import', icon: Upload },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  return (
    <aside className="w-64 bg-sidebar border-r border-border flex flex-col h-screen sticky top-0">
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
        <p className="text-xs text-muted-foreground">Data stored locally in your browser</p>
      </div>
    </aside>
  )
}
