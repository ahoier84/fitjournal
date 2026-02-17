import { useMemo } from 'react'
import { query, where, Timestamp } from 'firebase/firestore'
import { useAuth } from '@/contexts/AuthContext'
import { userCollection } from '@/db/database'
import { useFirestoreQuery } from './useFirestoreQuery'
import { toDateString, subDays } from '@/lib/date-utils'
import { eachDayOfInterval } from 'date-fns'
import type { DailyMetric } from '@/db/models'
import type { Workout } from '@/db/models'

export type MetricType = 'steps' | 'activeEnergy' | 'distanceWalkingRunning'

export function useActivityTrends(metricType: MetricType, days: number) {
  const { user } = useAuth()
  const endDate = new Date()
  const startDate = subDays(endDate, days - 1)
  const startStr = toDateString(startDate)
  const endStr = toDateString(endDate)

  const q = useMemo(() => {
    if (!user) return null
    return query(
      userCollection(user.uid, 'dailyMetrics'),
      where('metricType', '==', metricType),
      where('date', '>=', startStr),
      where('date', '<=', endStr),
    )
  }, [user, metricType, startStr, endStr])

  const metrics = useFirestoreQuery<DailyMetric>(q, [user?.uid, metricType, days])

  return useMemo(() => {
    if (!metrics) return undefined

    const valueMap = new Map(metrics.map(m => [m.date, m.value]))
    const allDays = eachDayOfInterval({ start: startDate, end: endDate })
    return allDays.map(d => {
      const dateStr = toDateString(d)
      return { date: dateStr, value: valueMap.get(dateStr) ?? 0 }
    })
  }, [metrics, days])
}

export function useWorkoutFrequency(days: number) {
  const { user } = useAuth()
  const endDate = new Date()
  const startDate = subDays(endDate, days - 1)

  const q = useMemo(() => {
    if (!user) return null
    return query(
      userCollection(user.uid, 'workouts'),
      where('startDate', '>=', Timestamp.fromDate(startDate)),
      where('startDate', '<=', Timestamp.fromDate(endDate)),
    )
  }, [user, days])

  const workouts = useFirestoreQuery<Workout>(q, [user?.uid, days])

  return useMemo(() => {
    if (!workouts) return undefined

    const weekMap = new Map<string, number>()
    for (const w of workouts) {
      const d = new Date(w.startDate)
      const weekStart = toDateString(subDays(d, d.getDay()))
      weekMap.set(weekStart, (weekMap.get(weekStart) ?? 0) + 1)
    }

    return Array.from(weekMap.entries())
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week))
  }, [workouts])
}
