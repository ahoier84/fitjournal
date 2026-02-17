import { useEffect, useState } from 'react'
import { onSnapshot, type Query, type DocumentReference, type DocumentData, type Timestamp } from 'firebase/firestore'

function convertTimestamps(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data }
  for (const [key, value] of Object.entries(result)) {
    if (value && typeof value === 'object' && 'toDate' in value) {
      result[key] = (value as Timestamp).toDate()
    }
  }
  return result
}

export function useFirestoreQuery<T>(
  queryOrNull: Query<DocumentData> | null,
  deps: unknown[] = []
): T[] | undefined {
  const [data, setData] = useState<T[] | undefined>(undefined)

  useEffect(() => {
    if (!queryOrNull) {
      setData(undefined)
      return
    }
    const unsubscribe = onSnapshot(queryOrNull, (snapshot) => {
      const results = snapshot.docs.map(doc => ({
        id: doc.id,
        ...convertTimestamps(doc.data()),
      })) as T[]
      setData(results)
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return data
}

export function useFirestoreDoc<T>(
  docRefOrNull: DocumentReference | null,
  deps: unknown[] = []
): T | undefined {
  const [data, setData] = useState<T | undefined>(undefined)

  useEffect(() => {
    if (!docRefOrNull) {
      setData(undefined)
      return
    }
    const unsubscribe = onSnapshot(docRefOrNull, (snapshot) => {
      if (snapshot.exists()) {
        setData({ id: snapshot.id, ...convertTimestamps(snapshot.data()) } as T)
      } else {
        setData(undefined)
      }
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return data
}
