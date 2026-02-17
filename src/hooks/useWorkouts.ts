import { useMemo } from 'react'
import { query, orderBy } from 'firebase/firestore'
import { useAuth } from '@/contexts/AuthContext'
import { userCollection, userDoc } from '@/db/database'
import { useFirestoreQuery, useFirestoreDoc } from './useFirestoreQuery'
import type { Workout } from '@/db/models'

export interface WorkoutFilters {
  activityType?: string
  startDate?: Date
  endDate?: Date
  sortBy?: 'date' | 'duration' | 'calories'
  sortOrder?: 'asc' | 'desc'
  limit?: number
}

export function useWorkouts(filters: WorkoutFilters = {}) {
  const { user } = useAuth()

  const q = useMemo(() => {
    if (!user) return null
    return query(userCollection(user.uid, 'workouts'), orderBy('startDate', 'desc'))
  }, [user])

  const raw = useFirestoreQuery<Workout>(q, [user?.uid])

  return useMemo(() => {
    if (!raw) return undefined

    let results = [...raw]

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
  }, [raw, filters.activityType, filters.startDate, filters.endDate, filters.sortBy, filters.sortOrder, filters.limit])
}

export function useWorkout(id: string | undefined) {
  const { user } = useAuth()

  const docRef = useMemo(() => {
    if (!user || !id) return null
    return userDoc(user.uid, 'workouts', id)
  }, [user, id])

  return useFirestoreDoc<Workout>(docRef, [user?.uid, id])
}

export function useWorkoutTypes() {
  const workouts = useWorkouts()

  return useMemo(() => {
    if (!workouts) return undefined
    const types = new Set(workouts.map(w => w.activityName))
    return Array.from(types).sort()
  }, [workouts])
}
