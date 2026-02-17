import { db } from '@/db/database'
import type { Workout, DailyMetric, ActivitySummary } from '@/db/models'
import type { WorkerMessage } from './health-xml-worker'
import { unzipSync, strFromU8 } from 'fflate'

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

async function readFileAsText(file: File): Promise<string> {
  if (file.name.endsWith('.zip')) {
    const arrayBuffer = await file.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(arrayBuffer))
    // Find the export.xml file inside the zip
    const xmlFile = Object.entries(unzipped).find(([name]) =>
      name.endsWith('export.xml') || name.includes('apple_health_export/export.xml')
    )
    if (!xmlFile) {
      throw new Error('Could not find export.xml in the zip file')
    }
    return strFromU8(xmlFile[1])
  }
  return file.text()
}

export async function parseHealthExport(
  file: File,
  onProgress: (progress: ImportProgress) => void
): Promise<ImportResult> {
  const startTime = performance.now()

  // Phase 1: Read file
  onProgress({ bytesRead: 0, totalBytes: file.size, workoutsFound: 0, recordsProcessed: 0, phase: 'reading' })

  const xmlText = await readFileAsText(file)
  const totalBytes = xmlText.length

  onProgress({ bytesRead: totalBytes, totalBytes, workoutsFound: 0, recordsProcessed: 0, phase: 'parsing' })

  // Phase 2: Parse in Web Worker
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
            totalBytes,
            workoutsFound: msg.workoutsFound,
            recordsProcessed: msg.recordsProcessed,
            phase: 'parsing',
          })
          break

        case 'workouts': {
          onProgress({ bytesRead: totalBytes, totalBytes, workoutsFound: msg.data.length, recordsProcessed: totalRecords, phase: 'saving' })

          // Check for existing sourceIds to avoid duplicates
          const existingIds = new Set(
            (await db.workouts.toArray()).map(w => w.sourceId)
          )

          const newWorkouts: Workout[] = msg.data
            .filter(w => !existingIds.has(w.sourceId))
            .map(w => ({
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
            }))

          if (newWorkouts.length > 0) {
            await db.workouts.bulkAdd(newWorkouts)
          }
          totalWorkouts += newWorkouts.length
          break
        }

        case 'dailyMetrics': {
          const metrics: DailyMetric[] = msg.data.map(m => ({
            date: m.date,
            metricType: m.metricType as DailyMetric['metricType'],
            value: m.value,
            unit: m.unit,
            updatedAt: new Date(),
          }))

          // Upsert: for each date+metricType, update if exists, add if not
          for (const metric of metrics) {
            const existing = await db.dailyMetrics
              .where('[date+metricType]')
              .equals([metric.date, metric.metricType])
              .first()

            if (existing) {
              await db.dailyMetrics.update(existing.id!, { value: metric.value, updatedAt: metric.updatedAt })
            } else {
              await db.dailyMetrics.add(metric)
            }
          }
          totalRecords += metrics.length
          break
        }

        case 'activitySummaries': {
          const summaries: ActivitySummary[] = msg.data.map(s => ({
            date: s.date,
            activeEnergyBurned: s.activeEnergyBurned,
            activeEnergyBurnedGoal: s.activeEnergyBurnedGoal,
            appleExerciseTime: s.appleExerciseTime,
            appleExerciseTimeGoal: s.appleExerciseTimeGoal,
            appleStandHours: s.appleStandHours,
            appleStandHoursGoal: s.appleStandHoursGoal,
            importedAt: new Date(),
          }))

          for (const summary of summaries) {
            const existing = await db.activitySummaries.where('date').equals(summary.date).first()
            if (existing) {
              await db.activitySummaries.update(existing.id!, summary)
            } else {
              await db.activitySummaries.add(summary)
            }
          }
          totalSummaries += summaries.length
          break
        }

        case 'complete': {
          worker.terminate()

          const durationMs = performance.now() - startTime

          // Save import record
          await db.importRecords.add({
            filename: file.name,
            importedAt: new Date(),
            workoutsImported: totalWorkouts,
            recordsImported: totalRecords,
            activitySummariesImported: totalSummaries,
            durationMs,
          })

          onProgress({ bytesRead: totalBytes, totalBytes, workoutsFound: totalWorkouts, recordsProcessed: totalRecords, phase: 'complete' })

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

    worker.postMessage({ text: xmlText, totalBytes })
  })
}
