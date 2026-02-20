import { setDoc, Timestamp } from 'firebase/firestore'
import { userDoc } from '@/db/database'
import { toDateString } from '@/lib/date-utils'

export async function saveDailyMetric(
  uid: string,
  metricType: 'steps' | 'activeEnergy',
  value: number
): Promise<void> {
  const date = toDateString(new Date())
  const docId = `${date}_${metricType}`

  await setDoc(userDoc(uid, 'dailyMetrics', docId), {
    date,
    metricType,
    value,
    unit: metricType === 'steps' ? 'count' : 'kcal',
    updatedAt: Timestamp.now(),
  })
}
