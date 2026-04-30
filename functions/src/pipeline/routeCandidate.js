import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { v4 as uuidv4 } from 'uuid'
import { sendScheduleLink } from '../email/sendScheduleLink.js'

const WEIGHTS = { resume: 0.4, interview: 0.6 }

function pipelineDecision({ stage, reasonCode, reasonLabel, note, candidate }) {
  const entry = {
    id: `system_${stage}_${Date.now()}`,
    outcome: 'advanced',
    stage,
    reasonCode,
    reasonLabel,
    note: note || '',
    selectionProcessVersion: candidate?.selectionProcessVersion || null,
    decidedAt: new Date().toISOString(),
    decidedBy: { uid: 'system', email: null },
  }

  return {
    latestDecision: entry,
    decisionHistory: FieldValue.arrayUnion(entry),
    decisionRecordedAt: FieldValue.serverTimestamp(),
  }
}

export async function routeCandidate(candidateId, resumeResult, videoResult) {
  const db = getFirestore()
  const candidateSnap = await db.collection('candidates').doc(candidateId).get()
  const candidate = candidateSnap.exists ? candidateSnap.data() : null

  // Automation can flag a concern, but it should not be the final rejection.
  // Keep the candidate in human review and record why the review is needed.
  if (resumeResult.autoDisqualified) {
    await db.collection('candidates').doc(candidateId).update({
      stage: 'scored',
      needsReview: true,
      ...pipelineDecision({
        stage: 'scored',
        reasonCode: 'automation_flagged_for_review',
        reasonLabel: 'Automation flagged application for human review',
        note: resumeResult.disqualifierReason || 'Resume scoring returned an automatic review flag.',
        candidate,
      }),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return
  }

  const compositeScore = parseFloat(
    (resumeResult.score * WEIGHTS.resume + videoResult.score * WEIGHTS.interview).toFixed(2)
  )

  let stage
  let needsReview = false
  let decisionReason
  if (compositeScore < 5) {
    stage = 'scored'
    needsReview = true
    decisionReason = {
      reasonCode: 'low_composite_requires_review',
      reasonLabel: 'Low composite score requires human review',
      note: `Composite score ${compositeScore}/10. No automatic rejection was sent.`,
    }
  } else if (compositeScore >= 8) {
    stage = 'to_schedule'
    decisionReason = {
      reasonCode: 'invite_threshold_met',
      reasonLabel: 'Selection score met interview invite threshold',
      note: `Composite score ${compositeScore}/10 met the configured scheduling threshold.`,
    }
  } else {
    stage = 'scored'
    needsReview = true
    decisionReason = {
      reasonCode: 'borderline_score_requires_review',
      reasonLabel: 'Borderline selection score requires human review',
      note: `Composite score ${compositeScore}/10 needs recruiter review.`,
    }
  }

  const schedulingToken = stage === 'to_schedule' ? uuidv4() : null

  const strengths = [...new Set([...(resumeResult.strengths || []), ...(videoResult.strengths || [])])]
  const concerns = [...new Set([...(resumeResult.concerns || []), ...(videoResult.concerns || [])])]

  await db.collection('candidates').doc(candidateId).update({
    compositeScore,
    strengths,
    concerns,
    stage,
    needsReview,
    ...pipelineDecision({
      stage,
      ...decisionReason,
      candidate,
    }),
    ...(schedulingToken ? { schedulingToken } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  })

  if (stage === 'to_schedule') {
    await sendScheduleLink(candidateId, schedulingToken)
  }
  // stage === 'scored' awaits human review before any rejection notice.
}
