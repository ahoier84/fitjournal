export interface Workout {
  id?: string
  sourceId: string
  workoutActivityType: string
  activityName: string
  duration: number // minutes
  totalEnergyBurned: number // kcal
  totalDistance: number // km
  sourceName: string
  startDate: Date
  endDate: Date
  creationDate: Date
  importedAt: Date
}

export interface DailyMetric {
  id?: string // "{date}_{metricType}"
  date: string // "YYYY-MM-DD"
  metricType: 'steps' | 'activeEnergy' | 'distanceWalkingRunning'
  value: number
  unit: string
  updatedAt: Date
}

export interface ActivitySummary {
  id?: string // "{date}"
  date: string // "YYYY-MM-DD"
  activeEnergyBurned: number
  activeEnergyBurnedGoal: number
  appleExerciseTime: number
  appleExerciseTimeGoal: number
  appleStandHours: number
  appleStandHoursGoal: number
  importedAt: Date
}

export interface JournalEntry {
  id?: string
  workoutId: string
  notes: string
  moodBefore: number // 1-5
  energyBefore: number // 1-5
  moodAfter: number // 1-5
  energyAfter: number // 1-5
  photos: string[] // base64 data URIs
  createdAt: Date
  updatedAt: Date
}

export interface ImportRecord {
  id?: string
  filename: string
  importedAt: Date
  workoutsImported: number
  recordsImported: number
  activitySummariesImported: number
  durationMs: number
}
