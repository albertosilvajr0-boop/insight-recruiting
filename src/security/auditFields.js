import { serverTimestamp } from 'firebase/firestore'
import { auth } from '../firebase'

export function adminAuditFields() {
  return {
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || null,
    updatedByEmail: auth.currentUser?.email || null,
  }
}
