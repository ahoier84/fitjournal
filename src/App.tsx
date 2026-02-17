import { HashRouter, Routes, Route } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { DashboardPage } from '@/pages/DashboardPage'
import { WorkoutHistoryPage } from '@/pages/WorkoutHistoryPage'
import { WorkoutDetailPage } from '@/pages/WorkoutDetailPage'
import { CalendarPage } from '@/pages/CalendarPage'
import { TrendsPage } from '@/pages/TrendsPage'
import { ImportPage } from '@/pages/ImportPage'
import { SettingsPage } from '@/pages/SettingsPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/workouts" element={<WorkoutHistoryPage />} />
          <Route path="/workouts/:id" element={<WorkoutDetailPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/trends" element={<TrendsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
