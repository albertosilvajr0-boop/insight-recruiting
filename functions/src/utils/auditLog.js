import { getFirestore, FieldValue } from 'firebase-admin/firestore'

function stripUndefined(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripUndefined)
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefined(entry)])
  )
}

export async function writeAuditLog({
  actorUid = 'system',
  actorEmail = null,
  action,
  targetType,
  targetId,
  metadata = {},
}) {
  if (!action || !targetType || !targetId) return

  try {
    const db = getFirestore()
    await db.collection('auditLogs').add(stripUndefined({
      actorUid,
      actorEmail,
      action,
      targetType,
      targetId,
      metadata,
      createdAt: FieldValue.serverTimestamp(),
    }))
  } catch (err) {
    console.error('[audit] write failed:', err)
  }
}
