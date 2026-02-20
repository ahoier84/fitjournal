import { Outlet } from 'react-router'
import { Sidebar, MobileBottomNav } from './Sidebar'

export function AppShell() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-4 md:p-8 overflow-auto pb-20 md:pb-8">
        <Outlet />
      </main>
      <MobileBottomNav />
    </div>
  )
}
