import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/database'
import { toDateString, subDays } from '@/lib/date-utils'
import { eachDayOfInterval } from 'date-fns'

export type MetricType = 'steps' | 'activeEnergy' | 'distanceWalkingRunning'

export function useActivityTrends(metricType: MetricType, days: number) {
  const endDate = new Date()
  const startDate = subDays(endDate, days - 1)
  const startStr = toDateString(startDate)
  const endStr = toDateString(endDate)

  return useLiveQuery(async () => {
    const metrics = await db.dailyMetrics
      .where('[date+metricType]')
      .between([startStr, metricType], [endStr, metricType], true, true)
      .toArray()

    const valueMap = new Map(metrics.map(m => [m.date, m.value]))

    const allDays = eachDayOfInterval({ start: startDate, end: endDate })
    return allDays.map(d => {
      const dateStr = toDateString(d)
      return {
        date: dateStr,
        value: valueMap.get(dateStr) ?? 0,
      }
    })
  }, [metricType, days])
}

export function useWorkoutFrequency(days: number) {
  const endDate = new Date()
  const startDate = subDays(endDate, days - 1)

  return useLiveQuery(async () => {
    const workouts = await db.workouts
      .where('startDate')
      .between(startDate, endDate, true, true)
      .toArray()

    const weekMap = new Map<string, number>()
    for (const w of workouts) {
      const d = new Date(w.startDate)
      const weekStart = toDateString(subDays(d, d.getDay()))
      weekMap.set(weekStart, (weekMap.get(weekStart) ?? 0) + 1)
    }

    return Array.from(weekMap.entries())
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week))
  }, [days])
}
