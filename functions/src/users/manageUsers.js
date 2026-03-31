import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const db = getFirestore()
const auth = getAuth()

/**
 * Creates a new Firebase Auth user and stores their profile in Firestore.
 */
export async function createUserHandler(data, context) {
  // Only authenticated users can create users
  if (!context.auth) {
    throw new Error('Authentication required.')
  }

  // Check that the caller is an admin
  const callerDoc = await db.collection('users').where('uid', '==', context.auth.uid).limit(1).get()
  if (callerDoc.empty || callerDoc.docs[0].data().role !== 'admin') {
    throw new Error('Only admins can create users.')
  }

  const { email, password, displayName, role, permissions } = data

  if (!email || !password) {
    throw new Error('Email and password are required.')
  }

  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters.')
  }

  // Create Firebase Auth user
  const userRecord = await auth.createUser({
    email,
    password,
    displayName: displayName || '',
    disabled: false,
  })

  // Store user profile in Firestore
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

  return { uid: userRecord.uid, email }
}

/**
 * Updates an existing Firebase Auth user and their Firestore profile.
 */
export async function updateUserHandler(data, context) {
  if (!context.auth) {
    throw new Error('Authentication required.')
  }

  const callerDoc = await db.collection('users').where('uid', '==', context.auth.uid).limit(1).get()
  if (callerDoc.empty || callerDoc.docs[0].data().role !== 'admin') {
    throw new Error('Only admins can update users.')
  }

  const { uid, email, password, displayName, disabled } = data

  if (!uid) {
    throw new Error('User ID is required.')
  }

  // Build Auth update payload
  const authUpdate = {}
  if (email) authUpdate.email = email
  if (password) authUpdate.password = password
  if (displayName !== undefined) authUpdate.displayName = displayName
  if (disabled !== undefined) authUpdate.disabled = disabled

  if (Object.keys(authUpdate).length > 0) {
    await auth.updateUser(uid, authUpdate)
  }

  return { uid, updated: true }
}

/**
 * Deletes a Firebase Auth user and their Firestore profile.
 */
export async function deleteUserHandler(data, context) {
  if (!context.auth) {
    throw new Error('Authentication required.')
  }

  // Prevent self-deletion
  if (data.uid === context.auth.uid) {
    throw new Error('You cannot delete your own account.')
  }

  const callerDoc = await db.collection('users').where('uid', '==', context.auth.uid).limit(1).get()
  if (callerDoc.empty || callerDoc.docs[0].data().role !== 'admin') {
    throw new Error('Only admins can delete users.')
  }

  const { uid } = data

  if (!uid) {
    throw new Error('User ID is required.')
  }

  // Delete from Firebase Auth
  await auth.deleteUser(uid)

  // Delete from Firestore
  await db.collection('users').doc(uid).delete()

  return { uid, deleted: true }
}
