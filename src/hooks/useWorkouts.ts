import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/database'

export interface WorkoutFilters {
  activityType?: string
  startDate?: Date
  endDate?: Date
  sortBy?: 'date' | 'duration' | 'calories'
  sortOrder?: 'asc' | 'desc'
  limit?: number
}

export function useWorkouts(filters: WorkoutFilters = {}) {
  return useLiveQuery(async () => {
    let collection = db.workouts.orderBy('startDate')

    let results = await collection.reverse().toArray()

    if (filters.activityType && filters.activityType !== 'all') {
      results = results.filter(w => w.activityName === filters.activityType)
    }

    if (filters.startDate) {
      results = results.filter(w => new Date(w.startDate) >= filters.startDate!)
    }

    if (filters.endDate) {
      results = results.filter(w => new Date(w.startDate) <= filters.endDate!)
    }

    if (filters.sortBy === 'duration') {
      results.sort((a, b) => filters.sortOrder === 'asc' ? a.duration - b.duration : b.duration - a.duration)
    } else if (filters.sortBy === 'calories') {
      results.sort((a, b) => filters.sortOrder === 'asc' ? a.totalEnergyBurned - b.totalEnergyBurned : b.totalEnergyBurned - a.totalEnergyBurned)
    }

    if (filters.limit) {
      results = results.slice(0, filters.limit)
    }

    return results
  }, [filters.activityType, filters.startDate?.getTime(), filters.endDate?.getTime(), filters.sortBy, filters.sortOrder, filters.limit])
}

export function useWorkout(id: number | undefined) {
  return useLiveQuery(
    () => id ? db.workouts.get(id) : undefined,
    [id]
  )
}

export function useWorkoutTypes() {
  return useLiveQuery(async () => {
    const workouts = await db.workouts.toArray()
    const types = new Set(workouts.map(w => w.activityName))
    return Array.from(types).sort()
  })
}
