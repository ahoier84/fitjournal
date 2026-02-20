import { HashRouter, Routes, Route } from 'react-router'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { WorkoutHistoryPage } from '@/pages/WorkoutHistoryPage'
import { WorkoutDetailPage } from '@/pages/WorkoutDetailPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { TrendsPage } from '@/pages/TrendsPage'
import { ImportPage } from '@/pages/ImportPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ManualWorkoutPage } from '@/pages/ManualWorkoutPage'

function AuthGate() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <LoginPage />
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/workouts" element={<WorkoutHistoryPage />} />
        <Route path="/workouts/new" element={<ManualWorkoutPage />} />
        <Route path="/workouts/:id" element={<WorkoutDetailPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/trends" element={<TrendsPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <AuthGate />
      </HashRouter>
    </AuthProvider>
  )
}

export default App
