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

// Read an XML file in slices and send text chunks to the worker.
// For ZIP files, we extract the XML first using fflate, but we
// process the decompressed content in manageable slices.
async function streamFileToWorker(file: File, worker: Worker): Promise<void> {
  const totalBytes = file.size

  if (file.name.endsWith('.zip')) {
    // For zip: decompress in streaming fashion, but use backpressure
    // by processing the zip in fixed-size slices of the raw file
    const { Unzip, UnzipInflate } = await import('fflate')

    return new Promise<void>((resolve, reject) => {
      let decompressedBytes = 0
      let foundXml = false
      let finished = false
      const decoder = new TextDecoder()

      const unzipper = new Unzip((stream) => {
        if (stream.name.endsWith('export.xml') || stream.name.includes('apple_health_export/export.xml')) {
          foundXml = true
          stream.ondata = (err, data, final) => {
            if (err) { reject(err); return }
            if (data && data.length > 0) {
              const text = decoder.decode(data, { stream: !final })
              decompressedBytes += data.length
              worker.postMessage({
                type: 'chunk',
                text,
                bytesRead: decompressedBytes,
                totalBytes: totalBytes * 4, // estimate: decompressed ~4x larger
              })
            }
            if (final) {
              finished = true
            }
          }
          stream.start()
        }
      })
      unzipper.register(UnzipInflate)

      // Read zip in 512KB slices to avoid memory spikes
      const SLICE_SIZE = 512 * 1024
      let offset = 0

      const readNextSlice = async () => {
        try {
          while (offset < file.size) {
            const end = Math.min(offset + SLICE_SIZE, file.size)
            const slice = file.slice(offset, end)
            const arrayBuffer = await slice.arrayBuffer()
            const isFinal = end >= file.size
            unzipper.push(new Uint8Array(arrayBuffer), isFinal)
            offset = end

            // Yield to event loop periodically to prevent blocking
            if (offset % (SLICE_SIZE * 4) === 0) {
              await new Promise(r => setTimeout(r, 0))
            }
          }

          if (!foundXml) {
            reject(new Error('Could not find export.xml in the zip file'))
          } else if (finished) {
            worker.postMessage({ type: 'done', totalBytes: decompressedBytes })
            resolve()
          } else {
            // Wait a bit for the last decompression callback
            setTimeout(() => {
              worker.postMessage({ type: 'done', totalBytes: decompressedBytes })
              resolve()
            }, 100)
          }
        } catch (err) {
          reject(err)
        }
      }

      readNextSlice()
    })
  }

  // For XML files, read in 1MB slices
  const SLICE_SIZE = 1024 * 1024
  const decoder = new TextDecoder()
  let offset = 0

  while (offset < file.size) {
    const end = Math.min(offset + SLICE_SIZE, file.size)
    const slice = file.slice(offset, end)
    const arrayBuffer = await slice.arrayBuffer()
    const isFinal = end >= file.size
    const text = decoder.decode(new Uint8Array(arrayBuffer), { stream: !isFinal })

    worker.postMessage({
      type: 'chunk',
      text,
      bytesRead: end,
      totalBytes,
    })

    offset = end

    // Yield to event loop
    if (offset % (SLICE_SIZE * 4) === 0) {
      await new Promise(r => setTimeout(r, 0))
    }
  }

  worker.postMessage({ type: 'done', totalBytes })
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

    streamFileToWorker(file, worker).catch(err => {
      worker.terminate()
      reject(err)
    })
  })
}
