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

// Process the XML text by scanning for complete self-closing tags.
// We process the text in passes by tag type to keep things simple.
// The text is already fully in memory in the worker thread.
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

  // Scan through the text character by character looking for tags we care about
  let i = 0
  let lastProgress = 0

  while (i < text.length) {
    // Find next '<'
    const tagStart = text.indexOf('<', i)
    if (tagStart === -1) break

    // Quick check: skip if not a tag we care about
    const nextChar = text.charCodeAt(tagStart + 1)

    // 'W' = 87, 'R' = 82, 'A' = 65
    if (nextChar !== 87 && nextChar !== 82 && nextChar !== 65) {
      // Skip to end of this tag
      const end = text.indexOf('>', tagStart + 1)
      i = end === -1 ? text.length : end + 1
      continue
    }

    // Find end of tag
    const tagEnd = text.indexOf('>', tagStart + 1)
    if (tagEnd === -1) break

    // Check if self-closing
    const isSelfClosing = text.charCodeAt(tagEnd - 1) === 47 // '/'

    // Extract tag name (up to first space)
    let nameEnd = tagStart + 1
    while (nameEnd < tagEnd && text.charCodeAt(nameEnd) !== 32) nameEnd++ // space
    const tagName = text.substring(tagStart + 1, nameEnd)

    if (tagName === 'Workout') {
      const attrEnd = isSelfClosing ? tagEnd - 1 : tagEnd
      const attrString = text.substring(nameEnd + 1, attrEnd)
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
    } else if (tagName === 'Record' && isSelfClosing) {
      const attrString = text.substring(nameEnd + 1, tagEnd - 1)
      const attrs = parseAttributes(attrString)
      const recordType = attrs.type as RecordType | undefined

      if (recordType && RECORD_TYPES_OF_INTEREST.includes(recordType as RecordType)) {
        const value = parseFloat(attrs.value || '0')
        const startDate = attrs.startDate || ''
        const dateStr = startDate.substring(0, 10)
        const metricType = RECORD_TYPE_TO_METRIC[recordType as RecordType]
        const key = `${dateStr}|${metricType}`
        dailyAggregates.set(key, (dailyAggregates.get(key) ?? 0) + value)
        recordsProcessed++
      }
    } else if (tagName === 'ActivitySummary' && isSelfClosing) {
      const attrString = text.substring(nameEnd + 1, tagEnd - 1)
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

    i = tagEnd + 1

    // Send progress every ~5MB
    if (i - lastProgress > 5_000_000) {
      lastProgress = i
      self.postMessage({
        type: 'progress',
        bytesRead: i,
        totalBytes,
        workoutsFound,
        recordsProcessed,
      } satisfies WorkerProgress)
    }
  }

  // Send results
  if (workoutBatch.length > 0) {
    self.postMessage({ type: 'workouts', data: workoutBatch } satisfies WorkerWorkouts)
  }

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

self.onmessage = async (e: MessageEvent<{ type: 'file'; buffer: ArrayBuffer; isZip: boolean }>) => {
  try {
    const { buffer, isZip } = e.data
    let xmlText: string

    if (isZip) {
      const unzipped = unzipSync(new Uint8Array(buffer))
      const xmlFile = Object.entries(unzipped).find(([name]) =>
        name.endsWith('export.xml') || name.includes('apple_health_export/export.xml')
      )
      if (!xmlFile) {
        throw new Error('Could not find export.xml in the zip file')
      }
      xmlText = strFromU8(xmlFile[1])
    } else {
      xmlText = new TextDecoder().decode(buffer)
    }

    processXmlText(xmlText)
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    } satisfies WorkerError)
  }
}
