import {
  Dumbbell,
  Bike,
  Footprints,
  Mountain,
  Waves,
  Heart,
  Zap,
  Music,
  type LucideIcon,
} from 'lucide-react'

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

export const WORKOUT_TYPE_ICONS: Record<string, LucideIcon> = {
  Running: Footprints,
  Walking: Footprints,
  Cycling: Bike,
  Hiking: Mountain,
  Swimming: Waves,
  Yoga: Heart,
  'Strength Training': Dumbbell,
  HIIT: Zap,
  'Core Training': Dumbbell,
  Dance: Music,
  Pilates: Heart,
  Elliptical: Zap,
  'Mixed Cardio': Zap,
  'Cross Training': Zap,
}

export const WORKOUT_TYPE_COLORS: Record<string, string> = {
  Running: '#ef4444',
  Walking: '#f97316',
  Cycling: '#eab308',
  Hiking: '#22c55e',
  Swimming: '#3b82f6',
  Yoga: '#a855f7',
  'Strength Training': '#6366f1',
  HIIT: '#ec4899',
  'Core Training': '#8b5cf6',
  Dance: '#f43f5e',
  Pilates: '#c084fc',
  Other: '#64748b',
}

export function getWorkoutIcon(activityName: string): LucideIcon {
  return WORKOUT_TYPE_ICONS[activityName] || Dumbbell
}

export function getWorkoutColor(activityName: string): string {
  return WORKOUT_TYPE_COLORS[activityName] || WORKOUT_TYPE_COLORS.Other
}

export function getActivityLabel(type: string): string {
  return WORKOUT_TYPE_LABELS[type] || type.replace('HKWorkoutActivityType', '')
}

export function formatDuration(minutes: number): string {
  const hrs = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  if (hrs === 0) return `${mins}m`
  if (mins === 0) return `${hrs}h`
  return `${hrs}h ${mins}m`
}

export function formatCalories(kcal: number): string {
  return `${Math.round(kcal)} cal`
}

export function formatDistance(km: number): string {
  const miles = km * 0.621371
  if (miles < 0.1) return `${Math.round(km * 1000)} m`
  return `${miles.toFixed(2)} mi`
}
