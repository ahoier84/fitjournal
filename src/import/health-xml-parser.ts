import { writeBatch, doc, setDoc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'
import { userCollection, userDoc } from '@/db/database'
import type { WorkerMessage } from './health-xml-worker'

// Parse Apple Health date strings like "2024-03-15 08:00:00 -0500"
// Standard Date constructor may fail on the space between date and time
function parseHealthDate(dateStr: string): Date {
  if (!dateStr) return new Date()
  // Replace first space with 'T' to make ISO-compatible: "2024-03-15T08:00:00 -0500"
  const iso = dateStr.replace(' ', 'T')
  const d = new Date(iso)
  if (!isNaN(d.getTime())) return d
  // Fallback: try original string
  const d2 = new Date(dateStr)
  if (!isNaN(d2.getTime())) return d2
  // Last resort: return current date
  return new Date()
}

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

// Write documents in batches of 500 (Firestore max).
// Each batch has a 30-second timeout to detect hangs.
async function commitBatches<T>(items: T[], label: string, writeFn: (batch: ReturnType<typeof writeBatch>, item: T) => void) {
  const totalBatches = Math.ceil(items.length / 500)
  for (let i = 0; i < items.length; i += 500) {
    const batchNum = Math.floor(i / 500) + 1
    const batch = writeBatch(firestore)
    const chunk = items.slice(i, i + 500)
    for (const item of chunk) {
      writeFn(batch, item)
    }
    console.log(`[Import] ${label}: committing batch ${batchNum}/${totalBatches} (${chunk.length} docs)...`)
    const commitPromise = batch.commit()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} batch ${batchNum}/${totalBatches} timed out after 30s`)), 30000)
    )
    await Promise.race([commitPromise, timeoutPromise])
    console.log(`[Import] ${label}: batch ${batchNum}/${totalBatches} done`)
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
            [chunkBuffer]
          )
          offset = end
          onProgress({ bytesRead: offset, totalBytes: file.size, workoutsFound: 0, recordsProcessed: 0, phase: 'reading' })
          await new Promise(r => setTimeout(r, 0))
        }
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

    // Queue worker messages so we process them one at a time
    const messageQueue: WorkerMessage[] = []
    let processing = false

    async function processQueue() {
      if (processing) return
      processing = true

      while (messageQueue.length > 0) {
        const msg = messageQueue.shift()!
        try {
          await handleMessage(msg)
        } catch (err) {
          worker.terminate()
          reject(err instanceof Error ? err : new Error('Unknown error during import'))
          return
        }
      }

      processing = false
    }

    async function handleMessage(msg: WorkerMessage) {
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
          console.log(`[Import] Received ${msg.data.length} workouts from worker, starting save...`)
          onProgress({ bytesRead: file.size, totalBytes: file.size, workoutsFound: msg.data.length, recordsProcessed: totalRecords, phase: 'saving' })

          await commitBatches(msg.data, 'Workouts', (batch, w) => {
            const ref = userDoc(uid, 'workouts', w.sourceId)
            batch.set(ref, {
              sourceId: w.sourceId,
              workoutActivityType: w.workoutActivityType,
              activityName: w.activityName,
              duration: w.duration,
              totalEnergyBurned: w.totalEnergyBurned,
              totalDistance: w.totalDistance,
              sourceName: w.sourceName,
              startDate: parseHealthDate(w.startDate),
              endDate: parseHealthDate(w.endDate),
              creationDate: parseHealthDate(w.creationDate),
              importedAt: new Date(),
            })
          })
          totalWorkouts += msg.data.length
          break
        }

        case 'dailyMetrics': {
          onProgress({ bytesRead: file.size, totalBytes: file.size, workoutsFound: totalWorkouts, recordsProcessed: msg.data.length, phase: 'saving' })

          await commitBatches(msg.data, 'DailyMetrics', (batch, m) => {
            const docId = `${m.date}_${m.metricType}`
            const ref = userDoc(uid, 'dailyMetrics', docId)
            batch.set(ref, {
              date: m.date,
              metricType: m.metricType,
              value: m.value,
              unit: m.unit,
              updatedAt: new Date(),
            }, { merge: true })
          })
          totalRecords += msg.data.length
          break
        }

        case 'activitySummaries': {
          await commitBatches(msg.data, 'ActivitySummaries', (batch, s) => {
            const ref = userDoc(uid, 'activitySummaries', s.date)
            batch.set(ref, {
              date: s.date,
              activeEnergyBurned: s.activeEnergyBurned,
              activeEnergyBurnedGoal: s.activeEnergyBurnedGoal,
              appleExerciseTime: s.appleExerciseTime,
              appleExerciseTimeGoal: s.appleExerciseTimeGoal,
              appleStandHours: s.appleStandHours,
              appleStandHoursGoal: s.appleStandHoursGoal,
              importedAt: new Date(),
            }, { merge: true })
          })
          totalSummaries += msg.data.length
          break
        }

        case 'complete': {
          worker.terminate()

          const durationMs = performance.now() - startTime

          const importRef = doc(userCollection(uid, 'importRecords'))
          await setDoc(importRef, {
            filename: file.name,
            importedAt: new Date(),
            workoutsImported: totalWorkouts,
            recordsImported: totalRecords,
            activitySummariesImported: totalSummaries,
            durationMs,
          })

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

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      messageQueue.push(e.data)
      processQueue()
    }

    worker.onerror = (err) => {
      worker.terminate()
      reject(new Error(err.message))
    }
  })
}
