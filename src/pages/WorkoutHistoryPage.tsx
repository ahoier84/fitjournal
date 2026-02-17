import { useState } from 'react'
import { Link } from 'react-router'
import { Search, SlidersHorizontal, BookOpen } from 'lucide-react'
import { useWorkouts, useWorkoutTypes } from '@/hooks/useWorkouts'
import { useJournalEntries } from '@/hooks/useJournalEntry'
import { formatDate, formatTime } from '@/lib/date-utils'
import { formatDuration, formatCalories, formatDistance, getWorkoutIcon, getWorkoutColor } from '@/lib/workout-utils'

export function WorkoutHistoryPage() {
  const [activityType, setActivityType] = useState('all')
  const [sortBy, setSortBy] = useState<'date' | 'duration' | 'calories'>('date')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [searchQuery, setSearchQuery] = useState('')

  const workoutTypes = useWorkoutTypes()
  const workouts = useWorkouts({ activityType, sortBy, sortOrder })
  const journalEntries = useJournalEntries()

  const journalWorkoutIds = new Set(journalEntries?.map(j => j.workoutId) ?? [])

  const filtered = workouts?.filter(w =>
    !searchQuery || w.activityName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Workout History</h2>

      <div className="bg-card rounded-xl border border-border p-4 mb-6">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search workouts..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <select
            value={activityType}
            onChange={e => setActivityType(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">All Types</option>
            {workoutTypes?.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={e => {
                const [s, o] = e.target.value.split('-')
                setSortBy(s as 'date' | 'duration' | 'calories')
                setSortOrder(o as 'asc' | 'desc')
              }}
              className="px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="date-desc">Newest First</option>
              <option value="date-asc">Oldest First</option>
              <option value="duration-desc">Longest First</option>
              <option value="duration-asc">Shortest First</option>
              <option value="calories-desc">Most Calories</option>
              <option value="calories-asc">Least Calories</option>
            </select>
          </div>
        </div>
      </div>

      {!filtered || filtered.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center text-muted-foreground">
          <p className="mb-2">No workouts found.</p>
          <Link to="/import" className="text-primary hover:underline text-sm">Import from Apple Health</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(workout => {
            const Icon = getWorkoutIcon(workout.activityName)
            const color = getWorkoutColor(workout.activityName)
            const hasJournal = journalWorkoutIds.has(workout.id!)

            return (
              <Link
                key={workout.id}
                to={`/workouts/${workout.id}`}
                className="flex items-center gap-4 p-4 bg-card rounded-xl border border-border hover:border-primary/30 transition-colors"
              >
                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: color + '15', color }}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{workout.activityName}</p>
                    {hasJournal && (
                      <BookOpen className="w-4 h-4 text-primary" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(workout.startDate)} at {formatTime(workout.startDate)}
                  </p>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-right">
                    <p className="font-medium">{formatDuration(workout.duration)}</p>
                    <p className="text-muted-foreground">duration</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatCalories(workout.totalEnergyBurned)}</p>
                    <p className="text-muted-foreground">energy</p>
                  </div>
                  {workout.totalDistance > 0 && (
                    <div className="text-right">
                      <p className="font-medium">{formatDistance(workout.totalDistance)}</p>
                      <p className="text-muted-foreground">distance</p>
                    </div>
                  )}
                </div>
              </Link>
            )
          })}
          <p className="text-sm text-muted-foreground text-center pt-4">
            {filtered.length} workout{filtered.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </div>
  )
}
