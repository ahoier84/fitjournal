import { setDoc, Timestamp } from 'firebase/firestore'
import { userDoc } from '@/db/database'
import { getWorkoutTypeKey } from '@/lib/workout-utils'

export interface ManualWorkoutInput {
  activityName: string
  startDate: Date
  duration: number          // minutes
  totalEnergyBurned: number // kcal
  totalDistance: number      // km (already converted from miles before calling)
}

export async function saveManualWorkout(uid: string, input: ManualWorkoutInput): Promise<string> {
  const docId = `manual_${input.startDate.getTime()}`
  const endDate = new Date(input.startDate.getTime() + input.duration * 60_000)

  await setDoc(userDoc(uid, 'workouts', docId), {
    sourceId: docId,
    workoutActivityType: getWorkoutTypeKey(input.activityName),
    activityName: input.activityName,
    duration: input.duration,
    totalEnergyBurned: input.totalEnergyBurned,
    totalDistance: input.totalDistance,
    sourceName: 'Manual',
    startDate: Timestamp.fromDate(input.startDate),
    endDate: Timestamp.fromDate(endDate),
    creationDate: Timestamp.now(),
    importedAt: Timestamp.now(),
  })

  return docId
}
