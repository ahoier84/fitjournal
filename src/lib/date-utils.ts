import { format, formatDistanceToNow, startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay } from 'date-fns'

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return format(d, 'MMM d, yyyy')
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return format(d, 'h:mm a')
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return format(d, 'MMM d, yyyy h:mm a')
}

export function formatRelative(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return formatDistanceToNow(d, { addSuffix: true })
}

export function toDateString(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function getDateRange(days: number) {
  const end = endOfDay(new Date())
  const start = startOfDay(subDays(new Date(), days - 1))
  return { start, end }
}

export function getWeekDays(date: Date = new Date()) {
  const start = startOfWeek(date, { weekStartsOn: 1 })
  const end = endOfWeek(date, { weekStartsOn: 1 })
  return eachDayOfInterval({ start, end })
}

export { isSameDay, format, startOfDay, endOfDay, subDays }
