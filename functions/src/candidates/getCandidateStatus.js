import { getFirestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

const PUBLIC_STAGES = new Set(['applied', 'screening', 'scored', 'to_schedule', 'scheduled', 'rejected', 'hired'])

function serializeTimestamp(value) {
  return value?.toDate ? value.toDate().toISOString() : null
}

export async function getCandidateStatusHandler(data) {
  const token = String(data?.token || '').trim()
  if (!token || token.length > 100) {
    throw new HttpsError('invalid-argument', 'A valid status token is required.')
  }

  const db = getFirestore()
  const snap = await db.collection('candidates')
    .where('statusToken', '==', token)
    .limit(1)
    .get()

  if (snap.empty) {
    throw new HttpsError('not-found', 'This status link is invalid or has expired.')
  }

  const candidate = snap.docs[0].data()
  const stage = PUBLIC_STAGES.has(candidate.stage) ? candidate.stage : 'applied'

  return {
    jobTitle: candidate.jobTitle || '',
    stage,
    createdAt: serializeTimestamp(candidate.createdAt),
    updatedAt: serializeTimestamp(candidate.updatedAt),
    scheduledAt: serializeTimestamp(candidate.scheduledAt),
  }
}
