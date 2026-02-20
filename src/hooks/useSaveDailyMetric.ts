import { setDoc, Timestamp } from 'firebase/firestore'
import { userDoc } from '@/db/database'
import { toDateString } from '@/lib/date-utils'

export type DailyMetricType = 'steps' | 'activeEnergy' | 'distanceWalkingRunning'

const METRIC_UNITS: Record<DailyMetricType, string> = {
  steps: 'count',
  activeEnergy: 'kcal',
  distanceWalkingRunning: 'km',
}

export async function saveDailyMetric(
  uid: string,
  metricType: DailyMetricType,
  value: number,
  date?: Date
): Promise<void> {
  const dateStr = toDateString(date ?? new Date())
  const docId = `${dateStr}_${metricType}`

  await setDoc(userDoc(uid, 'dailyMetrics', docId), {
    date: dateStr,
    metricType,
    value,
    unit: METRIC_UNITS[metricType],
    updatedAt: Timestamp.now(),
  })
}
