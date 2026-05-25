import { getAuth } from 'firebase-admin/auth'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { ROLES, ROLE_DEFAULT_PERMISSIONS, canManageUsers, normalizePermissions, normalizeRole } from '../security/roles.js'
import { writeAuditLog } from '../utils/auditLog.js'

const SUPERADMIN_EMAIL = (process.env.SUPERADMIN_EMAIL || 'albertosilva@silvaconsultinggroup.com').toLowerCase()

function callerEmail(context) {
  return context.auth?.token?.email || null
}

async function assertCallerIsAdmin(db, context) {
  if (!context.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  // The user doc ID is the Firebase Auth uid (see AdminLogin.jsx).
  const callerSnap = await db.collection('users').doc(context.auth.uid).get()
  const callerData = callerSnap.exists ? callerSnap.data() : null

  if (!canManageUsers(callerData)) {
    throw new HttpsError('permission-denied', 'Only superadmins can manage users.')
  }

  return callerData
}

export async function ensureCurrentUserProfileHandler(_data, context) {
  if (!context.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  const db = getFirestore()
  const auth = getAuth()
  const uid = context.auth.uid
  const email = callerEmail(context)?.toLowerCase()
  const userRef = db.collection('users').doc(uid)
  const userSnap = await userRef.get()

  if (userSnap.exists) {
    const user = userSnap.data()
    if (user.disabled === true) {
      throw new HttpsError('permission-denied', 'This account is disabled.')
    }
    if (!user.role) {
      throw new HttpsError('permission-denied', 'No admin role is assigned to this account.')
    }
    await userRef.set({
      lastLoginAt: FieldValue.serverTimestamp(),
      loginCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return {
      uid,
      email: user.email || email,
      displayName: user.displayName || '',
      role: user.role,
      permissions: user.permissions || ROLE_DEFAULT_PERMISSIONS[user.role] || [],
      disabled: user.disabled === true,
    }
  }

  if (!email || email !== SUPERADMIN_EMAIL) {
    throw new HttpsError('permission-denied', 'No admin profile exists for this account.')
  }

  const existingSuperadmins = await db.collection('users')
    .where('role', '==', ROLES.SUPERADMIN)
    .limit(1)
    .get()

  if (!existingSuperadmins.empty) {
    throw new HttpsError('permission-denied', 'No admin profile exists for this account.')
  }

  const userRecord = await auth.getUser(uid)
  const profile = {
    uid,
    email,
    displayName: userRecord.displayName || '',
    role: ROLES.SUPERADMIN,
    permissions: ROLE_DEFAULT_PERMISSIONS[ROLES.SUPERADMIN],
    disabled: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: 'bootstrap',
  }
  await userRef.set(profile)
  await writeAuditLog({
    actorUid: uid,
    actorEmail: email,
    action: 'user.bootstrap_superadmin',
    targetType: 'user',
    targetId: uid,
  })

  return {
    uid,
    email,
    displayName: profile.displayName,
    role: profile.role,
    permissions: profile.permissions,
    disabled: false,
  }
}

/**
 * Creates a new Firebase Auth user and stores their profile in Firestore.
 */
export async function createUserHandler(data, context) {
  const db = getFirestore()
  const auth = getAuth()

  await assertCallerIsAdmin(db, context)

  const { email, password, displayName, role, permissions, newApplicantEmailAlerts } = data || {}
  const normalizedRole = normalizeRole(role)
  const normalizedPermissions = normalizePermissions(normalizedRole, permissions)

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
      email: email.toLowerCase(),
      displayName: displayName || '',
      role: normalizedRole,
      permissions: normalizedPermissions,
      newApplicantEmailAlerts: newApplicantEmailAlerts === true,
      disabled: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: context.auth.uid,
    })
  } catch (err) {
    // Roll back the Auth user so we don't leave an orphan
    try {
      await auth.deleteUser(userRecord.uid)
    } catch (rollbackErr) {
      console.error('[createUser] rollback delete failed:', rollbackErr)
    }
    console.error('[createUser] Firestore write failed:', err)
    throw new HttpsError('internal', err?.message || 'Failed to save user profile.')
  }

  await writeAuditLog({
    actorUid: context.auth.uid,
    actorEmail: callerEmail(context),
    action: 'user.create',
    targetType: 'user',
    targetId: userRecord.uid,
    metadata: {
      role: normalizedRole,
      email: email.toLowerCase(),
      newApplicantEmailAlerts: newApplicantEmailAlerts === true,
    },
  })

  return { uid: userRecord.uid, email }
}

/**
 * Updates an existing Firebase Auth user and their Firestore profile.
 */
export async function updateUserHandler(data, context) {
  const db = getFirestore()
  const auth = getAuth()

  await assertCallerIsAdmin(db, context)

  const { uid, email, password, displayName, disabled, role, permissions, newApplicantEmailAlerts } = data || {}

  if (!uid) {
    throw new HttpsError('invalid-argument', 'User ID is required.')
  }

  if (uid === context.auth.uid && disabled === true) {
    throw new HttpsError('failed-precondition', 'You cannot disable your own account.')
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

  const normalizedRole = role ? normalizeRole(role) : undefined
  const firestoreUpdate = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: context.auth.uid,
  }
  if (email) firestoreUpdate.email = email.toLowerCase()
  if (displayName !== undefined) firestoreUpdate.displayName = displayName || ''
  if (disabled !== undefined) firestoreUpdate.disabled = disabled === true
  if (normalizedRole) firestoreUpdate.role = normalizedRole
  if (newApplicantEmailAlerts !== undefined) firestoreUpdate.newApplicantEmailAlerts = newApplicantEmailAlerts === true
  if (role || permissions) {
    firestoreUpdate.permissions = normalizePermissions(normalizedRole || role, permissions)
  }

  await db.collection('users').doc(uid).set(firestoreUpdate, { merge: true })

  await writeAuditLog({
    actorUid: context.auth.uid,
    actorEmail: callerEmail(context),
    action: 'user.update',
    targetType: 'user',
    targetId: uid,
    metadata: {
      changedEmail: Boolean(email),
      changedPassword: Boolean(password),
      role: normalizedRole,
      disabled,
      newApplicantEmailAlerts,
    },
  })

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

  await writeAuditLog({
    actorUid: context.auth.uid,
    actorEmail: callerEmail(context),
    action: 'user.delete',
    targetType: 'user',
    targetId: uid,
  })

  return { uid, deleted: true }
}
