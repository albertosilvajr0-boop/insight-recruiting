import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

const ADMIN_ROLES = ['superadmin', 'admin']

async function assertCallerIsAdmin(db, context) {
  if (!context.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  // The user doc ID is the Firebase Auth uid (see AdminLogin.jsx).
  const callerSnap = await db.collection('users').doc(context.auth.uid).get()
  const callerData = callerSnap.exists ? callerSnap.data() : null

  if (!callerData || !ADMIN_ROLES.includes(callerData.role)) {
    throw new HttpsError('permission-denied', 'Only superadmins can manage users.')
  }
}

/**
 * Creates a new Firebase Auth user and stores their profile in Firestore.
 */
export async function createUserHandler(data, context) {
  const db = getFirestore()
  const auth = getAuth()

  await assertCallerIsAdmin(db, context)

  const { email, password, displayName, role, permissions } = data || {}

  if (!email || !password) {
    throw new HttpsError('invalid-argument', 'Email and password are required.')
  }

  if (password.length < 6) {
    throw new HttpsError('invalid-argument', 'Password must be at least 6 characters.')
  }

  // Create Firebase Auth user
  let userRecord
  try {
    userRecord = await auth.createUser({
      email,
      password,
      displayName: displayName || '',
      disabled: false,
    })
  } catch (err) {
    if (err?.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'A user with this email already exists.')
    }
    if (err?.code === 'auth/invalid-email') {
      throw new HttpsError('invalid-argument', 'Please enter a valid email address.')
    }
    if (err?.code === 'auth/invalid-password') {
      throw new HttpsError('invalid-argument', 'Password does not meet requirements.')
    }
    console.error('[createUser] auth.createUser failed:', err)
    throw new HttpsError('internal', err?.message || 'Failed to create auth user.')
  }

  // Store user profile in Firestore
  try {
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      displayName: displayName || '',
      role: role || 'viewer',
      permissions: permissions || ['view_candidates', 'view_dashboard'],
      disabled: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: context.auth.uid,
    })
  } catch (err) {
    // Roll back the Auth user so we don't leave an orphan
    try { await auth.deleteUser(userRecord.uid) } catch {}
    console.error('[createUser] Firestore write failed:', err)
    throw new HttpsError('internal', err?.message || 'Failed to save user profile.')
  }

  return { uid: userRecord.uid, email }
}

/**
 * Updates an existing Firebase Auth user and their Firestore profile.
 */
export async function updateUserHandler(data, context) {
  const db = getFirestore()
  const auth = getAuth()

  await assertCallerIsAdmin(db, context)

  const { uid, email, password, displayName, disabled } = data || {}

  if (!uid) {
    throw new HttpsError('invalid-argument', 'User ID is required.')
  }

  // Build Auth update payload
  const authUpdate = {}
  if (email) authUpdate.email = email
  if (password) authUpdate.password = password
  if (displayName !== undefined) authUpdate.displayName = displayName
  if (disabled !== undefined) authUpdate.disabled = disabled

  if (Object.keys(authUpdate).length > 0) {
    try {
      await auth.updateUser(uid, authUpdate)
    } catch (err) {
      console.error('[updateUser] auth.updateUser failed:', err)
      throw new HttpsError('internal', err?.message || 'Failed to update user.')
    }
  }

  return { uid, updated: true }
}

/**
 * Deletes a Firebase Auth user and their Firestore profile.
 */
export async function deleteUserHandler(data, context) {
  const db = getFirestore()
  const auth = getAuth()

  if (!context.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  // Prevent self-deletion
  if (data?.uid === context.auth.uid) {
    throw new HttpsError('failed-precondition', 'You cannot delete your own account.')
  }

  await assertCallerIsAdmin(db, context)

  const { uid } = data || {}

  if (!uid) {
    throw new HttpsError('invalid-argument', 'User ID is required.')
  }

  try {
    // Delete from Firebase Auth
    await auth.deleteUser(uid)
    // Delete from Firestore
    await db.collection('users').doc(uid).delete()
  } catch (err) {
    console.error('[deleteUser] failed:', err)
    throw new HttpsError('internal', err?.message || 'Failed to delete user.')
  }

  return { uid, deleted: true }
}
