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

// Pending workout being assembled from opening tag + WorkoutStatistics children
interface PendingWorkout {
  workoutType: string
  activityName: string
  startDate: string
  endDate: string
  durationAttr: number       // duration from Workout attribute (may be 0 on iOS 16+)
  durationUnit: string       // unit for durationAttr (e.g. 'min' or 's')
  energyBurnedAttr: number   // totalEnergyBurned from Workout attribute (may be 0 on iOS 16+)
  distanceAttr: number       // totalDistance from Workout attribute (may be 0 on iOS 16+)
  distanceUnit: string       // unit for distanceAttr (e.g. 'km' or 'mi')
  sourceName: string
  creationDate: string
  // Values from WorkoutStatistics children (iOS 16+)
  statsEnergy: number
  statsDistance: number
  statsDistanceUnit: string  // unit from WorkoutStatistics distance element
}

class StreamingXmlProcessor {
  private leftover = ''
  private workoutBatch: WorkerWorkouts['data'] = []
  private workoutSourceIds = new Set<string>()
  private activitySummaryBatch: WorkerActivitySummaries['data'] = []
  private dailyAggregates = new Map<string, number>()

  // Track the current open Workout element so we can collect its WorkoutStatistics children
  private pendingWorkout: PendingWorkout | null = null

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

  // Parse Apple Health date strings like "2024-03-15 08:00:00 -0500"
  // Standard Date constructor may fail on the space between date and time
  private parseHealthDate(dateStr: string): number {
    if (!dateStr) return NaN
    // Replace first space with 'T' to make ISO-compatible
    const iso = dateStr.replace(' ', 'T')
    const t = new Date(iso).getTime()
    if (!isNaN(t)) return t
    return new Date(dateStr).getTime()
  }

  private computeDurationMinutes(startDate: string, endDate: string): number {
    const start = this.parseHealthDate(startDate)
    const end = this.parseHealthDate(endDate)
    if (isNaN(start) || isNaN(end)) return 0
    return (end - start) / 60000
  }

  private finalizeWorkout(pw: PendingWorkout) {
    // Use WorkoutStatistics values if available, fall back to Workout attributes
    const totalEnergyBurned = pw.statsEnergy > 0 ? pw.statsEnergy : pw.energyBurnedAttr
    const totalDistance = pw.statsDistance > 0 ? pw.statsDistance : pw.distanceAttr
    // Distance unit: WorkoutStatistics report in km, Workout attributes also in km
    // (Apple Health exports use the unit attribute — both are typically km)
    // No conversion needed — store as-is in km
    const distanceKm = pw.statsDistanceUnit === 'km' || pw.distanceUnit === 'km'
      ? totalDistance
      : totalDistance / 1000 // fallback: assume meters if unit not specified

    // Duration: prefer the attribute, convert based on unit.
    // Apple Health durationUnit is typically "min" (minutes) — divide by 60 only if seconds.
    let durationMinutes: number
    if (pw.durationAttr > 0) {
      if (pw.durationUnit === 'min') {
        durationMinutes = pw.durationAttr
      } else {
        // Assume seconds if no unit or unrecognized unit
        durationMinutes = pw.durationAttr / 60
      }
    } else {
      // Fallback: compute from start/end dates
      durationMinutes = this.computeDurationMinutes(pw.startDate, pw.endDate)
    }

    const sourceId = simpleHash(`${pw.workoutType}|${pw.startDate}|${pw.endDate}|${pw.sourceName}|${pw.durationAttr}`)
    if (!this.workoutSourceIds.has(sourceId)) {
      this.workoutSourceIds.add(sourceId)
      this.workoutBatch.push({
        sourceId,
        workoutActivityType: pw.workoutType,
        activityName: pw.activityName,
        duration: durationMinutes,
        totalEnergyBurned,
        totalDistance: distanceKm,
        sourceName: pw.sourceName,
        startDate: pw.startDate,
        endDate: pw.endDate,
        creationDate: pw.creationDate,
      })
      this.workoutsFound++
    }
  }

  private extractWorkouts(text: string) {
    // Single regex that matches exactly the tags we need, using alternation:
    // 1. </Workout>                         → closing tag
    // 2. <WorkoutStatistics\s.../>           → stats child element
    // 3. <Workout\s...> or <Workout\s.../>   → opening or self-closing workout
    // The \s after tag names prevents matching WorkoutEvent, WorkoutRoute, etc.
    const regex = /<\/Workout>|<WorkoutStatistics\s([^>]*?)\/>|<Workout\s([^>]*?)(\/?)>/g
    let match: RegExpExecArray | null

    while ((match = regex.exec(text)) !== null) {
      const fullMatch = match[0]

      // </Workout> — close the pending workout
      if (fullMatch === '</Workout>') {
        if (this.pendingWorkout) {
          this.finalizeWorkout(this.pendingWorkout)
          this.pendingWorkout = null
        }
        continue
      }

      // <WorkoutStatistics .../> — add stats to pending workout
      if (match[1] !== undefined) {
        if (this.pendingWorkout) {
          const attrs = parseAttributes(match[1])
          const statType = attrs.type || ''
          const sum = parseFloat(attrs.sum || '0')

          // Only count active energy — basal (resting) energy should NOT be
          // included in workout calories
          if (statType === 'HKQuantityTypeIdentifierActiveEnergyBurned') {
            this.pendingWorkout.statsEnergy += sum
          } else if (
            statType === 'HKQuantityTypeIdentifierDistanceWalkingRunning' ||
            statType === 'HKQuantityTypeIdentifierDistanceCycling' ||
            statType === 'HKQuantityTypeIdentifierDistanceSwimming'
          ) {
            // Use the largest distance stat rather than summing — a workout
            // shouldn't have multiple distance types, but if it does we want
            // the primary one, not an inflated total
            if (sum > this.pendingWorkout.statsDistance) {
              this.pendingWorkout.statsDistance = sum
              this.pendingWorkout.statsDistanceUnit = attrs.unit || ''
            }
          }
        }
        continue
      }

      // <Workout .../> or <Workout ...>
      if (match[2] !== undefined) {
        const isSelfClosing = match[3] === '/'
        const attrs = parseAttributes(match[2])
        const workoutType = attrs.workoutActivityType || ''
        const activityName = WORKOUT_TYPE_LABELS[workoutType] || workoutType.replace('HKWorkoutActivityType', '')
        const startDate = attrs.startDate || ''
        const endDate = attrs.endDate || ''
        const durationAttr = parseFloat(attrs.duration || '0')
        const durationUnit = (attrs.durationUnit || '').toLowerCase()
        const energyBurnedAttr = parseFloat(attrs.totalEnergyBurned || '0')
        const distanceAttr = parseFloat(attrs.totalDistance || '0')
        const distanceUnit = (attrs.totalDistanceUnit || '').toLowerCase()
        const sourceName = attrs.sourceName || ''
        const creationDate = attrs.creationDate || startDate

        if (isSelfClosing) {
          this.finalizeWorkout({
            workoutType, activityName, startDate, endDate,
            durationAttr, durationUnit, energyBurnedAttr, distanceAttr, distanceUnit,
            sourceName, creationDate, statsEnergy: 0, statsDistance: 0, statsDistanceUnit: '',
          })
        } else {
          // If there was a previous pending workout that never got closed, finalize it first
          if (this.pendingWorkout) {
            this.finalizeWorkout(this.pendingWorkout)
          }
          this.pendingWorkout = {
            workoutType, activityName, startDate, endDate,
            durationAttr, durationUnit, energyBurnedAttr, distanceAttr, distanceUnit,
            sourceName, creationDate, statsEnergy: 0, statsDistance: 0, statsDistanceUnit: '',
          }
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

    // Finalize any pending workout that never got a closing tag
    if (this.pendingWorkout) {
      this.finalizeWorkout(this.pendingWorkout)
      this.pendingWorkout = null
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
let finalized = false
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
      finalized = false
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

            if (final && !finalized) {
              finalized = true
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
          return
        }

        // Fallback: if fflate didn't call ondata with final=true,
        // finalize here to ensure results are always sent
        if (!finalized && processor) {
          finalized = true
          processor.finalize()
        }
      } else if (processor) {
        // Raw XML — finalize
        if (!finalized) {
          finalized = true
          processor.finalize()
        }
      }
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    } satisfies WorkerError)
  }
}
