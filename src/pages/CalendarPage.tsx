import { useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/database'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
} from 'date-fns'
import { toDateString, formatTime } from '@/lib/date-utils'
import { formatDuration, getWorkoutColor } from '@/lib/workout-utils'
import { cn } from '@/lib/utils'

export function CalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  // Get all workouts for visible month range
  const workouts = useLiveQuery(async () => {
    return db.workouts
      .where('startDate')
      .between(calendarStart, calendarEnd, true, true)
      .toArray()
  }, [calendarStart.getTime(), calendarEnd.getTime()])

  // Group workouts by day
  const workoutsByDay = new Map<string, typeof workouts>()
  workouts?.forEach(w => {
    const dateStr = toDateString(new Date(w.startDate))
    if (!workoutsByDay.has(dateStr)) workoutsByDay.set(dateStr, [])
    workoutsByDay.get(dateStr)!.push(w)
  })

  const selectedWorkouts = selectedDate
    ? workoutsByDay.get(toDateString(selectedDate)) ?? []
    : []

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Calendar</h2>

      <div className="bg-card rounded-xl border border-border p-6 mb-6">
        {/* Month Navigation */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => setCurrentMonth(m => subMonths(m, 1))}
            className="p-2 rounded-lg hover:bg-secondary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h3 className="text-lg font-semibold">{format(currentMonth, 'MMMM yyyy')}</h3>
          <button
            onClick={() => setCurrentMonth(m => addMonths(m, 1))}
            className="p-2 rounded-lg hover:bg-secondary transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Day Headers */}
        <div className="grid grid-cols-7 mb-2">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <div key={d} className="text-center text-xs font-medium text-muted-foreground py-2">{d}</div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map(day => {
            const dateStr = toDateString(day)
            const dayWorkouts = workoutsByDay.get(dateStr) ?? []
            const isCurrentMonth = isSameMonth(day, currentMonth)
            const isToday = isSameDay(day, new Date())
            const isSelected = selectedDate ? isSameDay(day, selectedDate) : false

            // Get unique workout types for color dots
            const workoutTypes = [...new Set(dayWorkouts.map(w => w.activityName))]

            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDate(isSelected ? null : day)}
                className={cn(
                  'aspect-square p-1 rounded-lg text-sm transition-colors flex flex-col items-center',
                  !isCurrentMonth && 'opacity-30',
                  isToday && 'ring-2 ring-primary',
                  isSelected && 'bg-primary/10',
                  dayWorkouts.length > 0 && 'hover:bg-secondary cursor-pointer',
                  dayWorkouts.length === 0 && 'hover:bg-secondary/50 cursor-pointer',
                )}
              >
                <span className={cn('text-sm', isToday && 'font-bold text-primary')}>{format(day, 'd')}</span>
                {workoutTypes.length > 0 && (
                  <div className="flex gap-0.5 mt-auto">
                    {workoutTypes.slice(0, 3).map((type, i) => (
                      <div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: getWorkoutColor(type) }}
                      />
                    ))}
                    {workoutTypes.length > 3 && (
                      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected Day Detail */}
      {selectedDate && (
        <div className="bg-card rounded-xl border border-border p-5">
          <h3 className="font-medium mb-3">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</h3>
          {selectedWorkouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No workouts on this day.</p>
          ) : (
            <div className="space-y-2">
              {selectedWorkouts.map(w => (
                <Link
                  key={w.id}
                  to={`/workouts/${w.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary transition-colors"
                >
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: getWorkoutColor(w.activityName) }}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{w.activityName}</p>
                    <p className="text-xs text-muted-foreground">{formatTime(w.startDate)}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">{formatDuration(w.duration)}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
