import { useMemo } from 'react'
import { query, where } from 'firebase/firestore'
import { useAuth } from '@/contexts/AuthContext'
import { userCollection } from '@/db/database'
import { useFirestoreQuery } from './useFirestoreQuery'
import { toDateString } from '@/lib/date-utils'
import type { DailyMetric } from '@/db/models'

export function useDailyStats(date: Date = new Date()) {
  const { user } = useAuth()
  const dateStr = toDateString(date)

  const q = useMemo(() => {
    if (!user) return null
    return query(userCollection(user.uid, 'dailyMetrics'), where('date', '==', dateStr))
  }, [user, dateStr])

  const metrics = useFirestoreQuery<DailyMetric>(q, [user?.uid, dateStr])

  return useMemo(() => {
    if (!metrics) return undefined
    const steps = metrics.find(m => m.metricType === 'steps')?.value ?? 0
    const activeEnergy = metrics.find(m => m.metricType === 'activeEnergy')?.value ?? 0
    const distance = metrics.find(m => m.metricType === 'distanceWalkingRunning')?.value ?? 0
    return { steps, activeEnergy, distance, date: dateStr }
  }, [metrics, dateStr])
}

export function useDailyStatsRange(startDate: Date, endDate: Date) {
  const { user } = useAuth()
  const startStr = toDateString(startDate)
  const endStr = toDateString(endDate)

  const q = useMemo(() => {
    if (!user) return null
    return query(
      userCollection(user.uid, 'dailyMetrics'),
      where('date', '>=', startStr),
      where('date', '<=', endStr),
    )
  }, [user, startStr, endStr])

  const metrics = useFirestoreQuery<DailyMetric>(q, [user?.uid, startStr, endStr])

  return useMemo(() => {
    if (!metrics) return undefined

    const byDate = new Map<string, { steps: number; activeEnergy: number; distance: number }>()
    for (const m of metrics) {
      if (!byDate.has(m.date)) {
        byDate.set(m.date, { steps: 0, activeEnergy: 0, distance: 0 })
      }
      const entry = byDate.get(m.date)!
      if (m.metricType === 'steps') entry.steps = m.value
      else if (m.metricType === 'activeEnergy') entry.activeEnergy = m.value
      else if (m.metricType === 'distanceWalkingRunning') entry.distance = m.value
    }

    return byDate
  }, [metrics])
}
