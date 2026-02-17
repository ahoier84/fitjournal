import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/database'
import type { JournalEntry } from '@/db/models'

export function useJournalEntry(workoutId: number | undefined) {
  return useLiveQuery(
    () => workoutId ? db.journalEntries.where('workoutId').equals(workoutId).first() : undefined,
    [workoutId]
  )
}

export async function saveJournalEntry(entry: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: number }) {
  const now = new Date()
  if (entry.id) {
    await db.journalEntries.update(entry.id, { ...entry, updatedAt: now })
  } else {
    const existing = await db.journalEntries.where('workoutId').equals(entry.workoutId).first()
    if (existing) {
      await db.journalEntries.update(existing.id!, { ...entry, updatedAt: now })
    } else {
      await db.journalEntries.add({ ...entry, createdAt: now, updatedAt: now } as JournalEntry)
    }
  }
}

export function useJournalEntries() {
  return useLiveQuery(() => db.journalEntries.toArray())
}
