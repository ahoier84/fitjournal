import { collection, doc } from 'firebase/firestore'
import { firestore } from '@/lib/firebase'

export function userCollection(uid: string, collectionName: string) {
  return collection(firestore, 'users', uid, collectionName)
}

export function userDoc(uid: string, collectionName: string, docId: string) {
  return doc(firestore, 'users', uid, collectionName, docId)
}
