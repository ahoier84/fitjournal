import { useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { saveManualWorkout } from '@/hooks/useManualWorkout'
import { MANUAL_WORKOUT_TYPES } from '@/lib/workout-utils'

function padTwo(n: number): string {
  return n.toString().padStart(2, '0')
}

function defaultTime(): string {
  const now = new Date()
  return `${padTwo(now.getHours())}:${padTwo(now.getMinutes())}`
}

function defaultDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${padTwo(now.getMonth() + 1)}-${padTwo(now.getDate())}`
}

export function ManualWorkoutPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [activityName, setActivityName] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [time, setTime] = useState(defaultTime)
  const [duration, setDuration] = useState('')
  const [calories, setCalories] = useState('')
  const [distance, setDistance] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!activityName) {
      setError('Please select an activity type.')
      return
    }
    if (!date || !time) {
      setError('Please enter a date and time.')
      return
    }
    const durationMin = parseFloat(duration)
    if (!duration || isNaN(durationMin) || durationMin < 1) {
      setError('Please enter a duration of at least 1 minute.')
      return
    }

    const caloriesKcal = parseFloat(calories) || 0
    const distanceMi = parseFloat(distance) || 0
    const distanceKm = distanceMi / 0.621371

    // Combine date + time into a Date
    const [year, month, day] = date.split('-').map(Number)
    const [hours, minutes] = time.split(':').map(Number)
    const startDate = new Date(year, month - 1, day, hours, minutes)

    if (!user) return

    setSaving(true)
    try {
      await saveManualWorkout(user.uid, {
        activityName,
        startDate,
        duration: durationMin,
        totalEnergyBurned: caloriesKcal,
        totalDistance: distanceKm,
      })
      navigate('/workouts')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workout.')
      setSaving(false)
    }
  }, [activityName, date, time, duration, calories, distance, user, navigate])

  const inputClass = 'w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50'

  return (
    <div className="max-w-2xl">
      <Link
        to="/workouts"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to workouts
      </Link>

      <h2 className="text-2xl font-bold mb-6">Log Workout</h2>

      <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-border p-6 space-y-5">
        {/* Activity Type */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">Activity Type</label>
          <select
            value={activityName}
            onChange={e => setActivityName(e.target.value)}
            className={inputClass}
          >
            <option value="">Select activity...</option>
            {MANUAL_WORKOUT_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        {/* Date and Time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Start Time</label>
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        {/* Duration */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">Duration (minutes)</label>
          <input
            type="number"
            value={duration}
            onChange={e => setDuration(e.target.value)}
            placeholder="30"
            min="1"
            max="1440"
            className={inputClass}
          />
        </div>

        {/* Calories and Distance */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Calories (kcal)</label>
            <input
              type="number"
              value={calories}
              onChange={e => setCalories(e.target.value)}
              placeholder="0"
              min="0"
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Distance (miles)</label>
            <input
              type="number"
              value={distance}
              onChange={e => setDistance(e.target.value)}
              placeholder="0"
              min="0"
              step="0.01"
              className={inputClass}
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-destructive/10 text-destructive text-sm px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2.5 rounded-lg font-medium text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Log Workout'}
        </button>
      </form>
    </div>
  )
}
