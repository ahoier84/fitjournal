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

  return new Promise<ImportResult>((resolve, reject) => {
    const worker = new Worker(
      new URL('./health-xml-worker.ts', import.meta.url),
      { type: 'module' }
    )

    // Tell the worker how big the file is and whether it's a zip
    const isZip = file.name.endsWith('.zip')
    worker.postMessage({ type: 'init', totalSize: file.size, isZip })

    // Read the file in 4MB chunks and transfer each to the worker.
    // The worker uses fflate streaming Unzip to decompress on the fly
    // and a streaming XML parser — nothing is ever fully in memory.
    const CHUNK_SIZE = 4 * 1024 * 1024 // 4 MB
    ;(async () => {
      try {
        let offset = 0
        while (offset < file.size) {
          const end = Math.min(offset + CHUNK_SIZE, file.size)
          const slice = file.slice(offset, end)
          const chunkBuffer = await slice.arrayBuffer()
          worker.postMessage(
            { type: 'chunk', buffer: chunkBuffer },
            [chunkBuffer] // transfer (zero-copy)
          )
          offset = end
          onProgress({ bytesRead: offset, totalBytes: file.size, workoutsFound: 0, recordsProcessed: 0, phase: 'reading' })
          // Yield to let the worker process and avoid message queue flooding
          await new Promise(r => setTimeout(r, 0))
        }
        // Signal that all chunks have been sent
        worker.postMessage({ type: 'done' })
        onProgress({ bytesRead: file.size, totalBytes: file.size, workoutsFound: 0, recordsProcessed: 0, phase: 'parsing' })
      } catch (err) {
        worker.terminate()
        reject(err instanceof Error ? err : new Error('Failed to read file'))
      }
    })()

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
  })
}
