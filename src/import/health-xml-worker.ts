import { WORKOUT_TYPE_LABELS, RECORD_TYPES_OF_INTEREST, RECORD_TYPE_TO_METRIC, RECORD_TYPE_UNITS, type RecordType } from './health-types'
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'

export interface WorkerProgress {
  type: 'progress'
  bytesRead: number
  totalBytes: number
  workoutsFound: number
  recordsProcessed: number
}

export interface WorkerWorkouts {
  type: 'workouts'
  data: Array<{
    sourceId: string
    workoutActivityType: string
    activityName: string
    duration: number
    totalEnergyBurned: number
    totalDistance: number
    sourceName: string
    startDate: string
    endDate: string
    creationDate: string
  }>
}

export interface WorkerDailyMetrics {
  type: 'dailyMetrics'
  data: Array<{
    date: string
    metricType: string
    value: number
    unit: string
  }>
}

export interface WorkerActivitySummaries {
  type: 'activitySummaries'
  data: Array<{
    date: string
    activeEnergyBurned: number
    activeEnergyBurnedGoal: number
    appleExerciseTime: number
    appleExerciseTimeGoal: number
    appleStandHours: number
    appleStandHoursGoal: number
  }>
}

export interface WorkerComplete {
  type: 'complete'
  stats: {
    workoutsFound: number
    recordsProcessed: number
    activitySummaries: number
    durationMs: number
  }
}

export interface WorkerError {
  type: 'error'
  message: string
}

export type WorkerMessage = WorkerProgress | WorkerWorkouts | WorkerDailyMetrics | WorkerActivitySummaries | WorkerComplete | WorkerError

function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const regex = /(\w+)="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(attrString)) !== null) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

// ---- Streaming XML tag processor ----
// Processes XML text chunk-by-chunk, extracting complete tags as they appear.
// Keeps a small leftover buffer (~1KB) for tags split across chunk boundaries.

class StreamingXmlProcessor {
  private leftover = ''
  private workoutBatch: WorkerWorkouts['data'] = []
  private workoutSourceIds = new Set<string>()
  private activitySummaryBatch: WorkerActivitySummaries['data'] = []
  private dailyAggregates = new Map<string, number>()

  workoutsFound = 0
  recordsProcessed = 0
  activitySummariesFound = 0
  totalBytesProcessed = 0

  private startTime = performance.now()
  private totalBytes = 0

  constructor(totalBytes: number) {
    this.totalBytes = totalBytes
  }

  // Process a chunk of XML text. Scans for complete tags of interest.
  processChunk(text: string) {
    // Prepend any leftover from previous chunk
    const data = this.leftover + text
    this.leftover = ''

    // Find the last '>' in the data — everything after it is incomplete
    const lastClose = data.lastIndexOf('>')
    if (lastClose === -1) {
      // No complete tag in this chunk, save it all as leftover
      this.leftover = data
      return
    }

    // Process complete portion, save remainder
    const complete = data.substring(0, lastClose + 1)
    this.leftover = data.substring(lastClose + 1)
    this.totalBytesProcessed += complete.length

    // Extract tags we care about using regex on this chunk
    this.extractWorkouts(complete)
    this.extractRecords(complete)
    this.extractActivitySummaries(complete)
  }

  private extractWorkouts(text: string) {
    // Match both self-closing and opening Workout tags
    const regex = /<Workout\s([^>]*?)(?:\/?>)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const isSelfClosing = match[0].endsWith('/>')
      const isOpenTag = !isSelfClosing

      // For opening tags that aren't self-closing, we still extract attributes from the opening tag
      if (isOpenTag || isSelfClosing) {
        const attrs = parseAttributes(match[1])
        const workoutType = attrs.workoutActivityType || ''
        const activityName = WORKOUT_TYPE_LABELS[workoutType] || workoutType.replace('HKWorkoutActivityType', '')
        const startDate = attrs.startDate || ''
        const endDate = attrs.endDate || ''
        const duration = parseFloat(attrs.duration || '0')
        const totalEnergyBurned = parseFloat(attrs.totalEnergyBurned || '0')
        const totalDistance = parseFloat(attrs.totalDistance || '0')
        const sourceName = attrs.sourceName || ''
        const creationDate = attrs.creationDate || startDate
        const sourceId = simpleHash(`${workoutType}|${startDate}|${endDate}|${sourceName}|${duration}`)
        if (!this.workoutSourceIds.has(sourceId)) {
          this.workoutSourceIds.add(sourceId)
          this.workoutBatch.push({
            sourceId, workoutActivityType: workoutType, activityName,
            duration: duration / 60, totalEnergyBurned,
            totalDistance: totalDistance / 1000, sourceName,
            startDate, endDate, creationDate,
          })
          this.workoutsFound++
        }
      }
    }
  }

  private extractRecords(text: string) {
    // Match Record tags (both self-closing and opening)
    const regex = /<Record\s([^>]*?)(?:\/?>)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const snippet = match[1]

      // Quick string filter — skip records we don't care about
      if (snippet.indexOf('StepCount') === -1 &&
          snippet.indexOf('ActiveEnergyBurned') === -1 &&
          snippet.indexOf('DistanceWalkingRunning') === -1) {
        continue
      }

      const attrs = parseAttributes(snippet)
      const recordType = attrs.type as RecordType | undefined
      if (!recordType || !RECORD_TYPES_OF_INTEREST.includes(recordType as RecordType)) continue

      const value = parseFloat(attrs.value || '0')
      const startDate = attrs.startDate || ''
      const dateStr = startDate.substring(0, 10)
      const metricType = RECORD_TYPE_TO_METRIC[recordType as RecordType]
      const key = `${dateStr}|${metricType}`
      this.dailyAggregates.set(key, (this.dailyAggregates.get(key) ?? 0) + value)
      this.recordsProcessed++

      if (this.recordsProcessed % 50000 === 0) {
        self.postMessage({
          type: 'progress',
          bytesRead: this.totalBytesProcessed,
          totalBytes: this.totalBytes,
          workoutsFound: this.workoutsFound,
          recordsProcessed: this.recordsProcessed,
        } satisfies WorkerProgress)
      }
    }
  }

  private extractActivitySummaries(text: string) {
    const regex = /<ActivitySummary\s([^>]*?)\/>/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const attrs = parseAttributes(match[1])
      this.activitySummaryBatch.push({
        date: attrs.dateComponents || '',
        activeEnergyBurned: parseFloat(attrs.activeEnergyBurned || '0'),
        activeEnergyBurnedGoal: parseFloat(attrs.activeEnergyBurnedGoal || '0'),
        appleExerciseTime: parseFloat(attrs.appleExerciseTime || '0'),
        appleExerciseTimeGoal: parseFloat(attrs.appleExerciseTimeGoal || '0'),
        appleStandHours: parseFloat(attrs.appleStandHours || '0'),
        appleStandHoursGoal: parseFloat(attrs.appleStandHoursGoal || '0'),
      })
      this.activitySummariesFound++
    }
  }

  // Called when all data has been processed. Sends final results.
  finalize() {
    // Process any remaining leftover
    if (this.leftover.length > 0) {
      this.extractWorkouts(this.leftover)
      this.extractRecords(this.leftover)
      this.extractActivitySummaries(this.leftover)
      this.leftover = ''
    }

    // Send all results
    if (this.workoutBatch.length > 0) {
      self.postMessage({ type: 'workouts', data: this.workoutBatch } satisfies WorkerWorkouts)
    }

    const dailyMetrics: WorkerDailyMetrics['data'] = []
    for (const [key, value] of this.dailyAggregates) {
      const [date, metricType] = key.split('|')
      const recordType = Object.entries(RECORD_TYPE_TO_METRIC).find(([, v]) => v === metricType)?.[0] as RecordType | undefined
      dailyMetrics.push({ date, metricType, value, unit: recordType ? RECORD_TYPE_UNITS[recordType] : '' })
    }

    if (dailyMetrics.length > 0) {
      self.postMessage({ type: 'dailyMetrics', data: dailyMetrics } satisfies WorkerDailyMetrics)
    }

    if (this.activitySummaryBatch.length > 0) {
      self.postMessage({ type: 'activitySummaries', data: this.activitySummaryBatch } satisfies WorkerActivitySummaries)
    }

    const durationMs = performance.now() - this.startTime
    self.postMessage({
      type: 'complete',
      stats: {
        workoutsFound: this.workoutsFound,
        recordsProcessed: this.recordsProcessed,
        activitySummaries: this.activitySummariesFound,
        durationMs,
      },
    } satisfies WorkerComplete)
  }
}

// ---- Message handling ----
// Protocol: init → chunk* → done
// For zip files: uses fflate streaming Unzip to decompress on the fly
// For xml files: decodes each chunk directly as text

let processor: StreamingXmlProcessor | null = null
let fileIsZip = false
let unzipper: Unzip | null = null
let xmlFileFound = false
const decoder = new TextDecoder()

type InitMessage = { type: 'init'; totalSize: number; isZip: boolean }
type ChunkMessage = { type: 'chunk'; buffer: ArrayBuffer }
type DoneMessage = { type: 'done' }
type IncomingMessage = InitMessage | ChunkMessage | DoneMessage

self.onmessage = (e: MessageEvent<IncomingMessage>) => {
  try {
    const msg = e.data

    if (msg.type === 'init') {
      fileIsZip = msg.isZip
      xmlFileFound = false
      processor = new StreamingXmlProcessor(msg.totalSize)

      if (fileIsZip) {
        // Set up streaming unzip
        unzipper = new Unzip()
        unzipper.register(UnzipInflate)
        unzipper.register(UnzipPassThrough)

        unzipper.onfile = (file) => {
          // Only process the export.xml file
          if (!file.name.endsWith('export.xml') && !file.name.includes('apple_health_export/export.xml')) {
            // Skip other files in the zip (like export_cda.xml, etc.)
            file.ondata = () => {} // must set handler to avoid errors
            file.start()
            return
          }

          xmlFileFound = true

          file.ondata = (err, data, final) => {
            if (err) {
              self.postMessage({
                type: 'error',
                message: `Decompression error: ${err.message}`,
              } satisfies WorkerError)
              return
            }

            // Decode this decompressed chunk to text and process it
            if (data.length > 0) {
              const text = decoder.decode(data, { stream: !final })
              processor!.processChunk(text)
            }

            if (final) {
              processor!.finalize()
            }
          }

          file.start()
        }
      }
      return
    }

    if (msg.type === 'chunk') {
      const chunk = new Uint8Array(msg.buffer)

      if (fileIsZip && unzipper) {
        // Push compressed chunk to streaming decompressor
        unzipper.push(chunk)
      } else if (!fileIsZip && processor) {
        // Raw XML — decode and process directly
        const text = decoder.decode(chunk, { stream: true })
        processor.processChunk(text)
      }
      return
    }

    if (msg.type === 'done') {
      if (fileIsZip && unzipper) {
        // Signal end of zip data
        unzipper.push(new Uint8Array(0), true)

        if (!xmlFileFound) {
          self.postMessage({
            type: 'error',
            message: 'Could not find export.xml in the zip file',
          } satisfies WorkerError)
        }
        // finalize() is called in the file.ondata handler when final=true
      } else if (processor) {
        // Raw XML — finalize
        processor.finalize()
      }
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    } satisfies WorkerError)
  }
}
