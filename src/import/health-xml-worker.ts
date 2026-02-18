import { WORKOUT_TYPE_LABELS, RECORD_TYPES_OF_INTEREST, RECORD_TYPE_TO_METRIC, RECORD_TYPE_UNITS, type RecordType } from './health-types'

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

// Message types sent TO the worker
export interface WorkerChunkMessage {
  type: 'chunk'
  text: string
  bytesRead: number
  totalBytes: number
}

export interface WorkerDoneMessage {
  type: 'done'
  totalBytes: number
}

export type WorkerInputMessage = WorkerChunkMessage | WorkerDoneMessage

// Simple hash for deduplication
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

// Streaming parser: accumulates text chunks and extracts complete XML elements
let buffer = ''
let workoutsFound = 0
let recordsProcessed = 0
let activitySummariesFound = 0
const startTime = performance.now()

const workoutBatch: WorkerWorkouts['data'] = []
const workoutSourceIds = new Set<string>()
const activitySummaryBatch: WorkerActivitySummaries['data'] = []
const dailyAggregates = new Map<string, number>()

function processBuffer(isFinal: boolean) {
  // Process self-closing Workout elements
  const workoutRegex = /<Workout\s([^>]*?)\/>/g
  let match: RegExpExecArray | null

  while ((match = workoutRegex.exec(buffer)) !== null) {
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
    if (!workoutSourceIds.has(sourceId)) {
      workoutSourceIds.add(sourceId)
      workoutBatch.push({
        sourceId,
        workoutActivityType: workoutType,
        activityName,
        duration: duration / 60,
        totalEnergyBurned,
        totalDistance: totalDistance / 1000,
        sourceName,
        startDate,
        endDate,
        creationDate,
      })
      workoutsFound++
    }
  }

  // Process non-self-closing Workout elements (opening tag only)
  const workoutBlockRegex = /<Workout\s([^/][^>]*?)>/g
  while ((match = workoutBlockRegex.exec(buffer)) !== null) {
    // Skip if this was actually a self-closing tag
    if (buffer[match.index + match[0].length - 2] === '/') continue

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
    if (!workoutSourceIds.has(sourceId)) {
      workoutSourceIds.add(sourceId)
      workoutBatch.push({
        sourceId,
        workoutActivityType: workoutType,
        activityName,
        duration: duration / 60,
        totalEnergyBurned,
        totalDistance: totalDistance / 1000,
        sourceName,
        startDate,
        endDate,
        creationDate,
      })
      workoutsFound++
    }
  }

  // Process Record elements
  const recordRegex = /<Record\s([^>]*?)\/>/g
  while ((match = recordRegex.exec(buffer)) !== null) {
    const attrs = parseAttributes(match[1])
    const recordType = attrs.type as RecordType | undefined

    if (!recordType || !RECORD_TYPES_OF_INTEREST.includes(recordType as RecordType)) continue

    const value = parseFloat(attrs.value || '0')
    const startDate = attrs.startDate || ''
    const dateStr = startDate.substring(0, 10)
    const metricType = RECORD_TYPE_TO_METRIC[recordType as RecordType]
    const key = `${dateStr}|${metricType}`

    dailyAggregates.set(key, (dailyAggregates.get(key) ?? 0) + value)
    recordsProcessed++
  }

  // Process ActivitySummary elements
  const activitySummaryRegex = /<ActivitySummary\s([^>]*?)\/>/g
  while ((match = activitySummaryRegex.exec(buffer)) !== null) {
    const attrs = parseAttributes(match[1])
    activitySummaryBatch.push({
      date: attrs.dateComponents || '',
      activeEnergyBurned: parseFloat(attrs.activeEnergyBurned || '0'),
      activeEnergyBurnedGoal: parseFloat(attrs.activeEnergyBurnedGoal || '0'),
      appleExerciseTime: parseFloat(attrs.appleExerciseTime || '0'),
      appleExerciseTimeGoal: parseFloat(attrs.appleExerciseTimeGoal || '0'),
      appleStandHours: parseFloat(attrs.appleStandHours || '0'),
      appleStandHoursGoal: parseFloat(attrs.appleStandHoursGoal || '0'),
    })
    activitySummariesFound++
  }

  if (!isFinal) {
    // Keep the last portion of the buffer in case an element spans chunks.
    // We keep the last 10KB to be safe for long attribute strings.
    const keepBytes = 10000
    if (buffer.length > keepBytes) {
      // Find the last '<' in the portion we'd discard to avoid splitting a tag
      const cutPoint = buffer.lastIndexOf('<', buffer.length - keepBytes)
      if (cutPoint > 0) {
        buffer = buffer.substring(cutPoint)
      } else {
        buffer = buffer.substring(buffer.length - keepBytes)
      }
    }
  }
}

self.onmessage = (e: MessageEvent<WorkerInputMessage>) => {
  const msg = e.data

  try {
    if (msg.type === 'chunk') {
      buffer += msg.text

      // Process what we have so far
      processBuffer(false)

      // Report progress
      self.postMessage({
        type: 'progress',
        bytesRead: msg.bytesRead,
        totalBytes: msg.totalBytes,
        workoutsFound,
        recordsProcessed,
      } satisfies WorkerProgress)
    } else if (msg.type === 'done') {
      // Process any remaining buffer
      processBuffer(true)

      // Send workouts
      if (workoutBatch.length > 0) {
        self.postMessage({ type: 'workouts', data: workoutBatch } satisfies WorkerWorkouts)
      }

      // Convert daily aggregates to metric records
      const dailyMetrics: WorkerDailyMetrics['data'] = []
      for (const [key, value] of dailyAggregates) {
        const [date, metricType] = key.split('|')
        const recordType = Object.entries(RECORD_TYPE_TO_METRIC).find(([, v]) => v === metricType)?.[0] as RecordType | undefined
        dailyMetrics.push({
          date,
          metricType,
          value,
          unit: recordType ? RECORD_TYPE_UNITS[recordType] : '',
        })
      }

      if (dailyMetrics.length > 0) {
        self.postMessage({ type: 'dailyMetrics', data: dailyMetrics } satisfies WorkerDailyMetrics)
      }

      // Send activity summaries
      if (activitySummaryBatch.length > 0) {
        self.postMessage({ type: 'activitySummaries', data: activitySummaryBatch } satisfies WorkerActivitySummaries)
      }

      const durationMs = performance.now() - startTime
      self.postMessage({
        type: 'complete',
        stats: {
          workoutsFound,
          recordsProcessed,
          activitySummaries: activitySummariesFound,
          durationMs,
        },
      } satisfies WorkerComplete)
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown parsing error',
    } satisfies WorkerError)
  }
}
