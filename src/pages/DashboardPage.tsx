import { useState, useCallback } from 'react'
import { Link } from 'react-router'
import { Footprints, Flame, MapPin, ChevronRight, ChevronLeft, Dumbbell, Plus } from 'lucide-react'
import { useWorkouts } from '@/hooks/useWorkouts'
import { useDailyStats } from '@/hooks/useDailyStats'
import { useDailyStatsRange } from '@/hooks/useDailyStats'
import { useAuth } from '@/contexts/AuthContext'
import { saveDailyMetric } from '@/hooks/useSaveDailyMetric'
import { formatDate, formatTime, getWeekDays, toDateString } from '@/lib/date-utils'
import { formatDuration, formatCalories, getWorkoutIcon, getWorkoutColor } from '@/lib/workout-utils'
import { EditableStatCard } from '@/components/dashboard/EditableStatCard'
import { cn } from '@/lib/utils'

function WeeklyOverview() {
  const weekDays = getWeekDays()
  const stats = useDailyStatsRange(weekDays[0], weekDays[6])

  if (!stats) return null

  const maxSteps = Math.max(...Array.from(stats.values()).map(s => s.steps), 1)
  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">This Week's Steps</h3>
      <div className="flex items-end gap-2 h-24">
        {weekDays.map((day, i) => {
          const dateStr = toDateString(day)
          const dayStats = stats.get(dateStr)
          const steps = dayStats?.steps ?? 0
          const height = maxSteps > 0 ? (steps / maxSteps) * 100 : 0
          const isToday = toDateString(new Date()) === dateStr

          return (
            <div key={dateStr} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex items-end justify-center" style={{ height: '80px' }}>
                <div
                  className={cn('w-full max-w-8 rounded-t-md transition-all', isToday ? 'bg-primary' : 'bg-primary/30')}
                  style={{ height: `${Math.max(height, 4)}%` }}
                />
              </div>
              <span className={cn('text-xs', isToday ? 'font-bold text-primary' : 'text-muted-foreground')}>{dayLabels[i]}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function DashboardPage() {
  const { user } = useAuth()
  const [selectedDate, setSelectedDate] = useState(new Date())
  const todayStats = useDailyStats(selectedDate)
  const recentWorkouts = useWorkouts({ limit: 5 })

  const todayStr = toDateString(new Date())
  const selectedStr = toDateString(selectedDate)
  const isToday = selectedStr === todayStr

  const goBack = useCallback(() => {
    setSelectedDate(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() - 1)
      return d
    })
  }, [])

  const goForward = useCallback(() => {
    if (isToday) return
    setSelectedDate(prev => {
      const d = new Date(prev)
      d.setDate(d.getDate() + 1)
      return d
    })
  }, [isToday])

  const goToday = useCallback(() => {
    setSelectedDate(new Date())
  }, [])

  const handleSaveSteps = useCallback(async (value: number) => {
    if (user) await saveDailyMetric(user.uid, 'steps', value, selectedDate)
  }, [user, selectedDate])

  const handleSaveCalories = useCallback(async (value: number) => {
    if (user) await saveDailyMetric(user.uid, 'activeEnergy', value, selectedDate)
  }, [user, selectedDate])

  const handleSaveDistance = useCallback(async (valueMiles: number) => {
    // Convert miles to km for storage
    const km = valueMiles / 0.621371
    if (user) await saveDailyMetric(user.uid, 'distanceWalkingRunning', km, selectedDate)
  }, [user, selectedDate])

  const distanceMiles = todayStats ? todayStats.distance * 0.621371 : 0

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

      {/* Date navigation */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={goBack}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          onClick={goToday}
          className={cn(
            'text-sm font-medium px-3 py-1 rounded-lg transition-colors',
            isToday ? 'text-primary' : 'text-foreground hover:bg-secondary'
          )}
        >
          {isToday ? 'Today' : formatDate(selectedDate)}
        </button>
        <button
          onClick={goForward}
          disabled={isToday}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <EditableStatCard
          icon={Footprints}
          label={isToday ? 'Steps Today' : 'Steps'}
          value={todayStats?.steps ?? 0}
          displayValue={todayStats ? todayStats.steps.toLocaleString() : '0'}
          unit="steps"
          color="#3b82f6"
          onSave={handleSaveSteps}
        />
        <EditableStatCard
          icon={Flame}
          label={isToday ? 'Active Energy' : 'Active Energy'}
          value={todayStats?.activeEnergy ?? 0}
          displayValue={todayStats ? Math.round(todayStats.activeEnergy).toLocaleString() : '0'}
          unit="cal"
          color="#ef4444"
          onSave={handleSaveCalories}
        />
        <EditableStatCard
          icon={MapPin}
          label="Distance"
          value={Math.round(distanceMiles * 100) / 100}
          displayValue={distanceMiles.toFixed(2)}
          unit="mi"
          color="#10b981"
          onSave={handleSaveDistance}
          step="0.01"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <WeeklyOverview />

        <div className="bg-card rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-muted-foreground">Recent Workouts</h3>
            <div className="flex items-center gap-3">
              <Link to="/workouts/new" className="text-sm text-primary hover:underline flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Log
              </Link>
              <Link to="/workouts" className="text-sm text-primary hover:underline flex items-center gap-1">
                View all <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {!recentWorkouts || recentWorkouts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No workouts yet.</p>
              <Link to="/import" className="text-sm text-primary hover:underline">Import from Apple Health</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {recentWorkouts.map(workout => {
                const Icon = getWorkoutIcon(workout.activityName)
                const color = getWorkoutColor(workout.activityName)
                return (
                  <Link
                    key={workout.id}
                    to={`/workouts/${workout.id}`}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary transition-colors"
                  >
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '15', color }}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{workout.activityName}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(workout.startDate)} at {formatTime(workout.startDate)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatDuration(workout.duration)}</p>
                      <p className="text-xs text-muted-foreground">{formatCalories(workout.totalEnergyBurned)}</p>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
