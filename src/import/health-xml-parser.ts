import { writeBatch, doc, getDocs, query } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { userCollection, userDoc } from '@/db/database'
import type { WorkerMessage } from './health-xml-worker'

export interface ImportProgress {
  bytesRead: number
  totalBytes: number
  workoutsFound: number
  recordsProcessed: number
  phase: 'reading' | 'parsing' | 'saving' | 'complete'
}

export interface ImportResult {
  workoutsImported: number
  recordsImported: number
  activitySummariesImported: number
  durationMs: number
}

async function commitBatches<T>(items: T[], writeFn: (batch: ReturnType<typeof writeBatch>, item: T) => void) {
  for (let i = 0; i < items.length; i += 500) {
    const batch = writeBatch(firestore)
    const chunk = items.slice(i, i + 500)
    for (const item of chunk) {
      writeFn(batch, item)
    }
    await batch.commit()
  }
}

export async function parseHealthExport(
  uid: string,
  file: File,
  onProgress: (progress: ImportProgress) => void
): Promise<ImportResult> {
  const startTime = performance.now()

  onProgress({ bytesRead: 0, totalBytes: file.size, workoutsFound: 0, recordsProcessed: 0, phase: 'reading' })

  // Transfer the file as an ArrayBuffer to the worker, which handles
  // both zip extraction and XML parsing in its own memory space.
  // We read in the main thread and transfer to avoid copies.
  const arrayBuffer = await file.arrayBuffer()

  onProgress({ bytesRead: file.size, totalBytes: file.size, workoutsFound: 0, recordsProcessed: 0, phase: 'parsing' })

  return new Promise<ImportResult>((resolve, reject) => {
    const worker = new Worker(
      new URL('./health-xml-worker.ts', import.meta.url),
      { type: 'module' }
    )

    let totalWorkouts = 0
    let totalRecords = 0
    let totalSummaries = 0

    worker.onmessage = async (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      switch (msg.type) {
        case 'progress':
          onProgress({
            bytesRead: msg.bytesRead,
            totalBytes: msg.totalBytes,
            workoutsFound: msg.workoutsFound,
            recordsProcessed: msg.recordsProcessed,
            phase: 'parsing',
          })
          break

        case 'workouts': {
          onProgress({ bytesRead: file.size, totalBytes: file.size, workoutsFound: msg.data.length, recordsProcessed: totalRecords, phase: 'saving' })

          const existingSnap = await getDocs(query(userCollection(uid, 'workouts')))
          const existingIds = new Set(existingSnap.docs.map(d => d.data().sourceId as string))
          const newWorkouts = msg.data.filter(w => !existingIds.has(w.sourceId))

          await commitBatches(newWorkouts, (batch, w) => {
            const ref = doc(userCollection(uid, 'workouts'))
            batch.set(ref, {
              sourceId: w.sourceId,
              workoutActivityType: w.workoutActivityType,
              activityName: w.activityName,
              duration: w.duration,
              totalEnergyBurned: w.totalEnergyBurned,
              totalDistance: w.totalDistance,
              sourceName: w.sourceName,
              startDate: new Date(w.startDate),
              endDate: new Date(w.endDate),
              creationDate: new Date(w.creationDate),
              importedAt: new Date(),
            })
          })
          totalWorkouts += newWorkouts.length
          break
        }

        case 'dailyMetrics': {
          const metrics = msg.data.map(m => ({
            date: m.date,
            metricType: m.metricType,
            value: m.value,
            unit: m.unit,
            updatedAt: new Date(),
          }))

          await commitBatches(metrics, (batch, metric) => {
            const docId = `${metric.date}_${metric.metricType}`
            const ref = userDoc(uid, 'dailyMetrics', docId)
            batch.set(ref, metric, { merge: true })
          })
          totalRecords += metrics.length
          break
        }

        case 'activitySummaries': {
          const summaries = msg.data.map(s => ({
            date: s.date,
            activeEnergyBurned: s.activeEnergyBurned,
            activeEnergyBurnedGoal: s.activeEnergyBurnedGoal,
            appleExerciseTime: s.appleExerciseTime,
            appleExerciseTimeGoal: s.appleExerciseTimeGoal,
            appleStandHours: s.appleStandHours,
            appleStandHoursGoal: s.appleStandHoursGoal,
            importedAt: new Date(),
          }))

          await commitBatches(summaries, (batch, summary) => {
            const ref = userDoc(uid, 'activitySummaries', summary.date)
            batch.set(ref, summary, { merge: true })
          })
          totalSummaries += summaries.length
          break
        }

        case 'complete': {
          worker.terminate()

          const durationMs = performance.now() - startTime

          const importRef = doc(userCollection(uid, 'importRecords'))
          const batch = writeBatch(firestore)
          batch.set(importRef, {
            filename: file.name,
            importedAt: new Date(),
            workoutsImported: totalWorkouts,
            recordsImported: totalRecords,
            activitySummariesImported: totalSummaries,
            durationMs,
          })
          await batch.commit()

          onProgress({ bytesRead: file.size, totalBytes: file.size, workoutsFound: totalWorkouts, recordsProcessed: totalRecords, phase: 'complete' })

          resolve({
            workoutsImported: totalWorkouts,
            recordsImported: totalRecords,
            activitySummariesImported: totalSummaries,
            durationMs,
          })
          break
        }

        case 'error':
          worker.terminate()
          reject(new Error(msg.message))
          break
      }
    }

    worker.onerror = (err) => {
      worker.terminate()
      reject(new Error(err.message))
    }

    // Transfer the ArrayBuffer to the worker (zero-copy)
    worker.postMessage(
      { type: 'file', buffer: arrayBuffer, isZip: file.name.endsWith('.zip') },
      [arrayBuffer]
    )
  })
}
