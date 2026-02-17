import Dexie, { type Table } from 'dexie'
import type {
  Workout,
  DailyMetric,
  ActivitySummary,
  JournalEntry,
  ImportRecord,
} from './models'

export class FitnessDatabase extends Dexie {
  workouts!: Table<Workout>
  dailyMetrics!: Table<DailyMetric>
  activitySummaries!: Table<ActivitySummary>
  journalEntries!: Table<JournalEntry>
  importRecords!: Table<ImportRecord>

  constructor() {
    super('FitnessTracker')

    this.version(1).stores({
      workouts: '++id, sourceId, workoutActivityType, startDate, [workoutActivityType+startDate]',
      dailyMetrics: '++id, [date+metricType], date, metricType',
      activitySummaries: '++id, &date',
      journalEntries: '++id, &workoutId, createdAt',
      importRecords: '++id, importedAt',
    })
  }
}

export const db = new FitnessDatabase()
