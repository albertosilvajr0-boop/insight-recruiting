import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { ROLES } from './roles.js'

export async function getCallerProfile(context) {
  if (!context.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  const db = getFirestore()
  const snap = await db.collection('users').doc(context.auth.uid).get()
  const profile = snap.exists ? snap.data() : null

  if (!profile || profile.disabled === true) {
    throw new HttpsError('permission-denied', 'This account is not allowed to access this action.')
  }

  return profile
}

export async function assertPermission(context, permission) {
  const profile = await getCallerProfile(context)
  if (profile.role === ROLES.SUPERADMIN) return profile
  if (Array.isArray(profile.permissions) && profile.permissions.includes(permission)) return profile
  throw new HttpsError('permission-denied', 'You do not have permission to perform this action.')
}
