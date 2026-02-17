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

// Parse the XML using a regex-based streaming approach that works with large files
// We read the file in chunks and extract elements using regex matching
self.onmessage = async (e: MessageEvent<{ text: string; totalBytes: number }>) => {
  const startTime = performance.now()
  const { text, totalBytes } = e.data

  try {
    let workoutsFound = 0
    let recordsProcessed = 0
    let activitySummariesFound = 0

    const workoutBatch: WorkerWorkouts['data'] = []
    const activitySummaryBatch: WorkerActivitySummaries['data'] = []
    const dailyAggregates = new Map<string, number>()

    // Parse using regex for self-closing XML elements (Apple Health export uses self-closing tags)
    // Match Workout elements
    const workoutRegex = /<Workout\s([^>]*?)\/>/g
    let match: RegExpExecArray | null

    while ((match = workoutRegex.exec(text)) !== null) {
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

      workoutBatch.push({
        sourceId,
        workoutActivityType: workoutType,
        activityName,
        duration: duration / 60, // seconds to minutes
        totalEnergyBurned,
        totalDistance: totalDistance / 1000, // meters to km (if in meters)
        sourceName,
        startDate,
        endDate,
        creationDate,
      })

      workoutsFound++

      if (workoutsFound % 50 === 0) {
        self.postMessage({
          type: 'progress',
          bytesRead: Math.min(workoutRegex.lastIndex, totalBytes),
          totalBytes,
          workoutsFound,
          recordsProcessed,
        } satisfies WorkerProgress)
      }
    }

    // Also check for Workout elements with child elements (non-self-closing)
    const workoutBlockRegex = /<Workout\s([^>]*?)>/g
    while ((match = workoutBlockRegex.exec(text)) !== null) {
      // Skip if we already matched this as self-closing
      if (text[match.index + match[0].length - 2] === '/') continue

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

      // Check for duplicate sourceId
      if (workoutBatch.some(w => w.sourceId === sourceId)) continue

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

    // Parse Record elements for steps, energy, distance
    const recordRegex = /<Record\s([^>]*?)\/>/g
    while ((match = recordRegex.exec(text)) !== null) {
      const attrs = parseAttributes(match[1])
      const recordType = attrs.type as RecordType | undefined

      if (!recordType || !RECORD_TYPES_OF_INTEREST.includes(recordType as RecordType)) continue

      const value = parseFloat(attrs.value || '0')
      const startDate = attrs.startDate || ''
      const dateStr = startDate.substring(0, 10) // "YYYY-MM-DD"
      const metricType = RECORD_TYPE_TO_METRIC[recordType as RecordType]
      const key = `${dateStr}|${metricType}`

      dailyAggregates.set(key, (dailyAggregates.get(key) ?? 0) + value)
      recordsProcessed++

      if (recordsProcessed % 10000 === 0) {
        self.postMessage({
          type: 'progress',
          bytesRead: Math.min(recordRegex.lastIndex, totalBytes),
          totalBytes,
          workoutsFound,
          recordsProcessed,
        } satisfies WorkerProgress)
      }
    }

    // Parse ActivitySummary elements
    const activitySummaryRegex = /<ActivitySummary\s([^>]*?)\/>/g
    while ((match = activitySummaryRegex.exec(text)) !== null) {
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
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown parsing error',
    } satisfies WorkerError)
  }
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
