export const WORKOUT_TYPE_LABELS: Record<string, string> = {
  HKWorkoutActivityTypeRunning: 'Running',
  HKWorkoutActivityTypeWalking: 'Walking',
  HKWorkoutActivityTypeCycling: 'Cycling',
  HKWorkoutActivityTypeYoga: 'Yoga',
  HKWorkoutActivityTypeHiking: 'Hiking',
  HKWorkoutActivityTypeSwimming: 'Swimming',
  HKWorkoutActivityTypeElliptical: 'Elliptical',
  HKWorkoutActivityTypeFunctionalStrengthTraining: 'Strength Training',
  HKWorkoutActivityTypeTraditionalStrengthTraining: 'Strength Training',
  HKWorkoutActivityTypeHighIntensityIntervalTraining: 'HIIT',
  HKWorkoutActivityTypeCoreTraining: 'Core Training',
  HKWorkoutActivityTypeDance: 'Dance',
  HKWorkoutActivityTypePilates: 'Pilates',
  HKWorkoutActivityTypeSocialDance: 'Dance',
  HKWorkoutActivityTypeMixedCardio: 'Mixed Cardio',
  HKWorkoutActivityTypeCrossTraining: 'Cross Training',
  HKWorkoutActivityTypeStairClimbing: 'Stair Climbing',
  HKWorkoutActivityTypeRowing: 'Rowing',
  HKWorkoutActivityTypeTennis: 'Tennis',
  HKWorkoutActivityTypeBasketball: 'Basketball',
  HKWorkoutActivityTypeSoccer: 'Soccer',
  HKWorkoutActivityTypeOther: 'Other',
}

export const RECORD_TYPES_OF_INTEREST = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierDistanceWalkingRunning',
] as const

export type RecordType = typeof RECORD_TYPES_OF_INTEREST[number]

export const RECORD_TYPE_TO_METRIC: Record<RecordType, string> = {
  HKQuantityTypeIdentifierStepCount: 'steps',
  HKQuantityTypeIdentifierActiveEnergyBurned: 'activeEnergy',
  HKQuantityTypeIdentifierDistanceWalkingRunning: 'distanceWalkingRunning',
}

export const RECORD_TYPE_UNITS: Record<RecordType, string> = {
  HKQuantityTypeIdentifierStepCount: 'count',
  HKQuantityTypeIdentifierActiveEnergyBurned: 'kcal',
  HKQuantityTypeIdentifierDistanceWalkingRunning: 'km',
}
