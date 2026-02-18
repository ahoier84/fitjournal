import { WORKOUT_TYPE_LABELS, RECORD_TYPES_OF_INTEREST, RECORD_TYPE_TO_METRIC, RECORD_TYPE_UNITS, type RecordType } from './health-types'
import { unzipSync, strFromU8 } from 'fflate'

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

function processXmlText(text: string) {
  const startTime = performance.now()
  const totalBytes = text.length
  let workoutsFound = 0
  let recordsProcessed = 0
  let activitySummariesFound = 0

  const workoutBatch: WorkerWorkouts['data'] = []
  const workoutSourceIds = new Set<string>()
  const activitySummaryBatch: WorkerActivitySummaries['data'] = []
  const dailyAggregates = new Map<string, number>()

  // Pass 1: Workouts (self-closing)
  const workoutSCRegex = /<Workout\s([^>]*?)\/>/g
  let match: RegExpExecArray | null
  while ((match = workoutSCRegex.exec(text)) !== null) {
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
      workoutBatch.push({ sourceId, workoutActivityType: workoutType, activityName, duration: duration / 60, totalEnergyBurned, totalDistance: totalDistance / 1000, sourceName, startDate, endDate, creationDate })
      workoutsFound++
    }
  }

  // Pass 2: Workouts (non-self-closing opening tags)
  const workoutBlockRegex = /<Workout\s([^>]*?)>/g
  while ((match = workoutBlockRegex.exec(text)) !== null) {
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
    if (!workoutSourceIds.has(sourceId)) {
      workoutSourceIds.add(sourceId)
      workoutBatch.push({ sourceId, workoutActivityType: workoutType, activityName, duration: duration / 60, totalEnergyBurned, totalDistance: totalDistance / 1000, sourceName, startDate, endDate, creationDate })
      workoutsFound++
    }
  }

  self.postMessage({
    type: 'progress', bytesRead: 0, totalBytes, workoutsFound, recordsProcessed,
  } satisfies WorkerProgress)

  // Pass 3: Records (self-closing) — this is the big one, millions of elements
  const recordRegex = /<Record\s([^>]*?)\/>/g
  while ((match = recordRegex.exec(text)) !== null) {
    const snippet = match[1]

    // Quick filter: check if this is a record type we care about
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
    dailyAggregates.set(key, (dailyAggregates.get(key) ?? 0) + value)
    recordsProcessed++

    if (recordsProcessed % 50000 === 0) {
      self.postMessage({
        type: 'progress', bytesRead: recordRegex.lastIndex, totalBytes, workoutsFound, recordsProcessed,
      } satisfies WorkerProgress)
    }
  }

  // Pass 4: Records (non-self-closing) — some Record elements have child MetadataEntry elements
  const recordBlockRegex = /<Record\s([^>]*?)(?<!\\)>/g
  while ((match = recordBlockRegex.exec(text)) !== null) {
    // Skip self-closing (already handled above)
    if (match[0].endsWith('/>')) continue

    const snippet = match[1]
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
    dailyAggregates.set(key, (dailyAggregates.get(key) ?? 0) + value)
    recordsProcessed++
  }

  // Pass 5: ActivitySummary elements
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

  // Send all results
  if (workoutBatch.length > 0) {
    self.postMessage({ type: 'workouts', data: workoutBatch } satisfies WorkerWorkouts)
  }

  const dailyMetrics: WorkerDailyMetrics['data'] = []
  for (const [key, value] of dailyAggregates) {
    const [date, metricType] = key.split('|')
    const recordType = Object.entries(RECORD_TYPE_TO_METRIC).find(([, v]) => v === metricType)?.[0] as RecordType | undefined
    dailyMetrics.push({ date, metricType, value, unit: recordType ? RECORD_TYPE_UNITS[recordType] : '' })
  }

  if (dailyMetrics.length > 0) {
    self.postMessage({ type: 'dailyMetrics', data: dailyMetrics } satisfies WorkerDailyMetrics)
  }

  if (activitySummaryBatch.length > 0) {
    self.postMessage({ type: 'activitySummaries', data: activitySummaryBatch } satisfies WorkerActivitySummaries)
  }

  const durationMs = performance.now() - startTime
  self.postMessage({
    type: 'complete',
    stats: { workoutsFound, recordsProcessed, activitySummaries: activitySummariesFound, durationMs },
  } satisfies WorkerComplete)
}

// Chunked file reception: main thread sends init → chunk* → done
let fileIsZip = false
let chunks: Uint8Array[] = []
let receivedBytes = 0

type InitMessage = { type: 'init'; totalSize: number; isZip: boolean }
type ChunkMessage = { type: 'chunk'; buffer: ArrayBuffer }
type DoneMessage = { type: 'done' }
type IncomingMessage = InitMessage | ChunkMessage | DoneMessage

self.onmessage = (e: MessageEvent<IncomingMessage>) => {
  try {
    const msg = e.data

    if (msg.type === 'init') {
      fileIsZip = msg.isZip
      chunks = []
      receivedBytes = 0
      return
    }

    if (msg.type === 'chunk') {
      const chunk = new Uint8Array(msg.buffer)
      chunks.push(chunk)
      receivedBytes += chunk.byteLength
      return
    }

    if (msg.type === 'done') {
      // Combine all chunks into a single Uint8Array
      const combined = new Uint8Array(receivedBytes)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.byteLength
      }
      // Free chunk references
      chunks = []

      let xmlText: string

      if (fileIsZip) {
        const unzipped = unzipSync(combined)
        const xmlFile = Object.entries(unzipped).find(([name]) =>
          name.endsWith('export.xml') || name.includes('apple_health_export/export.xml')
        )
        if (!xmlFile) {
          throw new Error('Could not find export.xml in the zip file')
        }
        xmlText = strFromU8(xmlFile[1])
      } else {
        xmlText = new TextDecoder().decode(combined)
      }

      processXmlText(xmlText)
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    } satisfies WorkerError)
  }
}
