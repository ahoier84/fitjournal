import { useMemo } from 'react'
import { query, where, limit, getDocs, addDoc, updateDoc, Timestamp } from 'firebase/firestore'
import { useAuth } from '@/contexts/AuthContext'
import { userCollection } from '@/db/database'
import { useFirestoreQuery } from './useFirestoreQuery'
import type { JournalEntry } from '@/db/models'

export function useJournalEntry(workoutId: string | undefined) {
  const { user } = useAuth()

  const q = useMemo(() => {
    if (!user || !workoutId) return null
    return query(userCollection(user.uid, 'journalEntries'), where('workoutId', '==', workoutId), limit(1))
  }, [user, workoutId])

  const results = useFirestoreQuery<JournalEntry>(q, [user?.uid, workoutId])

  return results?.[0]
}

export async function saveJournalEntry(
  uid: string,
  entry: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
) {
  const now = Timestamp.now()
  const col = userCollection(uid, 'journalEntries')

  // Check if entry with this workoutId already exists
  const existing = await getDocs(query(col, where('workoutId', '==', entry.workoutId), limit(1)))

  if (!existing.empty) {
    const docRef = existing.docs[0].ref
    const { id: _id, ...data } = entry
    await updateDoc(docRef, { ...data, updatedAt: now })
  } else {
    const { id: _id, ...data } = entry
    await addDoc(col, { ...data, createdAt: now, updatedAt: now })
  }
}

export function useJournalEntries() {
  const { user } = useAuth()

  const q = useMemo(() => {
    if (!user) return null
    return query(userCollection(user.uid, 'journalEntries'))
  }, [user])

  return useFirestoreQuery<JournalEntry>(q, [user?.uid])
}
