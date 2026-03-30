import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { v4 as uuidv4 } from 'uuid'
import { sendRejectionEmail } from '../email/sendRejection.js'
import { sendScheduleLink } from '../email/sendScheduleLink.js'

const WEIGHTS = { resume: 0.4, interview: 0.6 }

export async function routeCandidate(candidateId, resumeResult, videoResult) {
  const db = getFirestore()

  // If auto-disqualified, rejection was already queued in scoreResume
  if (resumeResult.autoDisqualified) {
    await sendRejectionEmail(candidateId)
    return
  }

  const compositeScore = parseFloat(
    (resumeResult.score * WEIGHTS.resume + videoResult.score * WEIGHTS.interview).toFixed(2)
  )

  let stage
  if (compositeScore < 5) {
    stage = 'rejected'
  } else if (compositeScore >= 8) {
    stage = 'scheduling'
  } else {
    stage = 'interview_2' // flagged for admin review
  }

  const schedulingToken = stage === 'scheduling' ? uuidv4() : null

  // Aggregate strengths/concerns from both evaluations
  const strengths = [...new Set([...(resumeResult.strengths || []), ...(videoResult.strengths || [])])]
  const concerns = [...new Set([...(resumeResult.concerns || []), ...(videoResult.concerns || [])])]

  await db.collection('candidates').doc(candidateId).update({
    compositeScore,
    strengths,
    concerns,
    stage,
    ...(schedulingToken ? { schedulingToken } : {}),
    updatedAt: FieldValue.serverTimestamp()
  })

  // Trigger appropriate email
  if (stage === 'rejected') {
    await sendRejectionEmail(candidateId)
  } else if (stage === 'scheduling') {
    await sendScheduleLink(candidateId, schedulingToken)
  }
  // stage === 'interview_2' → no email, awaits admin action
}
