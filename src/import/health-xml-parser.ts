import { auth } from '@/lib/firebase'
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

// ---- Firestore REST API helpers ----
// Bypass the Firestore SDK entirely to avoid its internal exponential backoff
// state that persists across import attempts within the same browser session.

const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`

async function getAuthToken(): Promise<string> {
  const user = auth.currentUser
  if (!user) throw new Error('Not authenticated')
  return user.getIdToken()
}

// Convert a JS value to a Firestore REST API value object
function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null }
  if (typeof val === 'string') return { stringValue: val }
  if (typeof val === 'boolean') return { booleanValue: val }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) }
    return { doubleValue: val }
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() }
  if (Array.isArray(val)) return { arrayValue: { values: val.map(toFirestoreValue) } }
  if (typeof val === 'object') {
    const fields: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      fields[k] = toFirestoreValue(v)
    }
    return { mapValue: { fields } }
  }
  return { stringValue: String(val) }
}

// Build a Firestore document body from a plain object
function buildDocBody(data: Record<string, unknown>): { fields: Record<string, unknown> } {
  const fields: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    fields[k] = toFirestoreValue(v)
  }
  return { fields }
}

const BATCH_SIZE = 100
const BATCH_DELAY_MS = 500

// Write documents using Firestore REST API batch commit
async function commitBatchesRest(
  uid: string,
  items: Array<{ collection: string; docId: string; data: Record<string, unknown> }>,
  label: string,
) {
  const token = await getAuthToken()
  const totalBatches = Math.ceil(items.length / BATCH_SIZE)

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const chunk = items.slice(i, i + BATCH_SIZE)

    const writes = chunk.map(item => ({
      update: {
        name: `projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}/${item.collection}/${item.docId}`,
        fields: buildDocBody(item.data).fields,
      },
    }))

    console.log(`[Import] ${label}: committing batch ${batchNum}/${totalBatches} (${chunk.length} docs)...`)

    const resp = await fetch(`${FIRESTORE_BASE}:batchWrite`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ writes }),
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Firestore batchWrite failed (${resp.status}): ${text}`)
    }

    console.log(`[Import] ${label}: batch ${batchNum}/${totalBatches} done`)

    if (i + BATCH_SIZE < items.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
    }
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

          const workoutDocs = msg.data.map(w => ({
            collection: 'workouts',
            docId: w.sourceId,
            data: {
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
            },
          }))
          await commitBatchesRest(uid, workoutDocs, 'Workouts')
          totalWorkouts += msg.data.length
          break
        }

        case 'dailyMetrics': {
          onProgress({ bytesRead: file.size, totalBytes: file.size, workoutsFound: totalWorkouts, recordsProcessed: msg.data.length, phase: 'saving' })

          const metricDocs = msg.data.map(m => ({
            collection: 'dailyMetrics',
            docId: `${m.date}_${m.metricType}`,
            data: {
              date: m.date,
              metricType: m.metricType,
              value: m.value,
              unit: m.unit,
              updatedAt: new Date(),
            },
          }))
          await commitBatchesRest(uid, metricDocs, 'DailyMetrics')
          totalRecords += msg.data.length
          break
        }

        case 'activitySummaries': {
          const summaryDocs = msg.data.map(s => ({
            collection: 'activitySummaries',
            docId: s.date,
            data: {
              date: s.date,
              activeEnergyBurned: s.activeEnergyBurned,
              activeEnergyBurnedGoal: s.activeEnergyBurnedGoal,
              appleExerciseTime: s.appleExerciseTime,
              appleExerciseTimeGoal: s.appleExerciseTimeGoal,
              appleStandHours: s.appleStandHours,
              appleStandHoursGoal: s.appleStandHoursGoal,
              importedAt: new Date(),
            },
          }))
          await commitBatchesRest(uid, summaryDocs, 'ActivitySummaries')
          totalSummaries += msg.data.length
          break
        }

        case 'complete': {
          worker.terminate()

          const durationMs = performance.now() - startTime

          // Save import record via REST too
          const importDocId = `import_${Date.now()}`
          await commitBatchesRest(uid, [{
            collection: 'importRecords',
            docId: importDocId,
            data: {
              filename: file.name,
              importedAt: new Date(),
              workoutsImported: totalWorkouts,
              recordsImported: totalRecords,
              activitySummariesImported: totalSummaries,
              durationMs,
            },
          }], 'ImportRecord')

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
