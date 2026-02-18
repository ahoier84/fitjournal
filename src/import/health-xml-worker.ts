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

// State
let buffer = ''
let workoutsFound = 0
let recordsProcessed = 0
let activitySummariesFound = 0
const startTime = performance.now()

const workoutBatch: WorkerWorkouts['data'] = []
const workoutSourceIds = new Set<string>()
const activitySummaryBatch: WorkerActivitySummaries['data'] = []
const dailyAggregates = new Map<string, number>()

// Process a single self-closing XML element like <Tag attr="val"/>
function processElement(tagName: string, attrString: string) {
  if (tagName === 'Workout') {
    const attrs = parseAttributes(attrString)
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
  } else if (tagName === 'Record') {
    const attrs = parseAttributes(attrString)
    const recordType = attrs.type as RecordType | undefined
    if (!recordType || !RECORD_TYPES_OF_INTEREST.includes(recordType as RecordType)) return

    const value = parseFloat(attrs.value || '0')
    const startDate = attrs.startDate || ''
    const dateStr = startDate.substring(0, 10)
    const metricType = RECORD_TYPE_TO_METRIC[recordType as RecordType]
    const key = `${dateStr}|${metricType}`

    dailyAggregates.set(key, (dailyAggregates.get(key) ?? 0) + value)
    recordsProcessed++
  } else if (tagName === 'ActivitySummary') {
    const attrs = parseAttributes(attrString)
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
}

// Scan the buffer for complete self-closing tags, process them,
// and return the index up to which the buffer has been consumed.
function scanBuffer(): number {
  let consumed = 0
  let i = 0

  while (i < buffer.length) {
    // Find start of a tag
    const tagStart = buffer.indexOf('<', i)
    if (tagStart === -1) {
      consumed = i
      break
    }

    // Check if we have enough buffer to see the tag name
    if (tagStart + 1 >= buffer.length) {
      consumed = tagStart
      break
    }

    const nextChar = buffer[tagStart + 1]

    // Skip closing tags, comments, processing instructions, CDATA, DOCTYPE
    if (nextChar === '/' || nextChar === '!' || nextChar === '?') {
      // Find end of this tag
      const tagEnd = buffer.indexOf('>', tagStart + 1)
      if (tagEnd === -1) {
        consumed = tagStart
        break
      }
      i = tagEnd + 1
      continue
    }

    // We have an opening tag. Find the end of it.
    const tagEnd = buffer.indexOf('>', tagStart + 1)
    if (tagEnd === -1) {
      // Incomplete tag — stop here, keep from tagStart
      consumed = tagStart
      break
    }

    // Check if self-closing
    const isSelfClosing = buffer[tagEnd - 1] === '/'

    // Extract tag name
    const tagContent = buffer.substring(tagStart + 1, tagEnd)
    const spaceIdx = tagContent.indexOf(' ')
    let tagName: string
    let attrString: string

    if (spaceIdx === -1) {
      tagName = isSelfClosing ? tagContent.substring(0, tagContent.length - 1).trim() : tagContent.trim()
      attrString = ''
    } else {
      tagName = tagContent.substring(0, spaceIdx)
      attrString = isSelfClosing
        ? tagContent.substring(spaceIdx + 1, tagContent.length - 1)
        : tagContent.substring(spaceIdx + 1)
    }

    if (isSelfClosing) {
      // Process self-closing elements we care about
      if (tagName === 'Workout' || tagName === 'Record' || tagName === 'ActivitySummary') {
        processElement(tagName, attrString)
      }
    } else if (tagName === 'Workout') {
      // Non-self-closing Workout — extract attrs from opening tag
      processElement('Workout', attrString)
    }

    i = tagEnd + 1
  }

  // If we processed everything
  if (i >= buffer.length) {
    consumed = buffer.length
  }

  return consumed
}

function processChunk() {
  const consumed = scanBuffer()
  if (consumed > 0) {
    buffer = buffer.substring(consumed)
  }
}

self.onmessage = (e: MessageEvent<WorkerInputMessage>) => {
  const msg = e.data

  try {
    if (msg.type === 'chunk') {
      buffer += msg.text
      processChunk()

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
      processChunk()

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
