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

// Stream the file as text chunks using ReadableStream
// This avoids loading the entire file into memory at once
async function streamFileToWorker(file: File, worker: Worker): Promise<void> {
  const totalBytes = file.size

  // For zip files, we need a different approach — use streaming decompression
  if (file.name.endsWith('.zip')) {
    // Import fflate dynamically only when needed for zip
    const { Unzip, UnzipInflate } = await import('fflate')

    return new Promise<void>((resolve, reject) => {
      let bytesRead = 0
      let foundXml = false

      const unzipper = new Unzip((stream) => {
        // Look for export.xml in the zip entries
        if (stream.name.endsWith('export.xml') || stream.name.includes('apple_health_export/export.xml')) {
          foundXml = true
          stream.ondata = (err, data, final) => {
            if (err) {
              reject(err)
              return
            }
            if (data && data.length > 0) {
              // Decode the Uint8Array chunk to string
              const text = new TextDecoder().decode(data)
              bytesRead += data.length
              worker.postMessage({
                type: 'chunk',
                text,
                bytesRead,
                totalBytes,
              })
            }
            if (final) {
              worker.postMessage({ type: 'done', totalBytes })
              resolve()
            }
          }
          stream.start()
        }
      })
      unzipper.register(UnzipInflate)

      // Read the zip file in chunks
      const reader = file.stream().getReader()
      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              unzipper.push(new Uint8Array(0), true)
              if (!foundXml) {
                reject(new Error('Could not find export.xml in the zip file'))
              }
              break
            }
            unzipper.push(value)
          }
        } catch (err) {
          reject(err)
        }
      }
      pump()
    })
  }

  // For XML files, stream directly using ReadableStream
  const stream = file.stream()
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const text = decoder.decode(value, { stream: true })
    bytesRead += value.length

    worker.postMessage({
      type: 'chunk',
      text,
      bytesRead,
      totalBytes,
    })
  }

  // Flush any remaining decoder state
  const finalText = decoder.decode()
  if (finalText) {
    worker.postMessage({
      type: 'chunk',
      text: finalText,
      bytesRead,
      totalBytes,
    })
  }

  worker.postMessage({ type: 'done', totalBytes })
}

async function commitBatches<T>(items: T[], writeFn: (batch: ReturnType<typeof writeBatch>, item: T) => void) {
  // Firestore batch limit is 500 operations
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

  // Phase 1: Start streaming
  onProgress({ bytesRead: 0, totalBytes: file.size, workoutsFound: 0, recordsProcessed: 0, phase: 'reading' })

  // Phase 2: Parse in Web Worker with streaming chunks
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
            totalBytes: file.size,
            workoutsFound: msg.workoutsFound,
            recordsProcessed: msg.recordsProcessed,
            phase: 'parsing',
          })
          break

        case 'workouts': {
          onProgress({ bytesRead: file.size, totalBytes: file.size, workoutsFound: msg.data.length, recordsProcessed: totalRecords, phase: 'saving' })

          // Check for existing sourceIds to avoid duplicates
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

          // Use composite doc ID for upsert: date_metricType
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

          // Use date as doc ID for upsert
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

          // Save import record
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

    // Start streaming the file to the worker
    streamFileToWorker(file, worker).catch(err => {
      worker.terminate()
      reject(err)
    })
  })
}
