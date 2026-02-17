import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/database'
import { toDateString } from '@/lib/date-utils'

export function useDailyStats(date: Date = new Date()) {
  const dateStr = toDateString(date)
  return useLiveQuery(async () => {
    const metrics = await db.dailyMetrics
      .where('[date+metricType]')
      .between([dateStr, ''], [dateStr, '\uffff'])
      .toArray()

    const steps = metrics.find(m => m.metricType === 'steps')?.value ?? 0
    const activeEnergy = metrics.find(m => m.metricType === 'activeEnergy')?.value ?? 0
    const distance = metrics.find(m => m.metricType === 'distanceWalkingRunning')?.value ?? 0

    return { steps, activeEnergy, distance, date: dateStr }
  }, [dateStr])
}

export function useDailyStatsRange(startDate: Date, endDate: Date) {
  const startStr = toDateString(startDate)
  const endStr = toDateString(endDate)
  return useLiveQuery(async () => {
    const metrics = await db.dailyMetrics
      .where('date')
      .between(startStr, endStr, true, true)
      .toArray()

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
  }, [startStr, endStr])
}
