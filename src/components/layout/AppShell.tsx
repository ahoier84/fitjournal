import { Outlet } from 'react-router'
import { Sidebar } from './Sidebar'

export function AppShell() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
