import { writeAuditLog } from '../utils/auditLog.js'

const TRACKED_FIELDS = [
  'stage',
  'manualScore',
  'manualResumeScores',
  'manualAnswerScores',
  'needsReview',
  'scheduledAt',
  'scheduledSlotId',
  'adminNotes',
]

function changedFields(before, after) {
  return TRACKED_FIELDS.filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null))
}

export async function auditCandidateUpdate(event) {
  const before = event.data.before.data()
  const after = event.data.after.data()
  const fields = changedFields(before, after)
  if (fields.length === 0) return

  await writeAuditLog({
    actorUid: after.updatedBy || 'system',
    actorEmail: after.updatedByEmail || null,
    action: 'candidate.update',
    targetType: 'candidate',
    targetId: event.params.candidateId,
    metadata: {
      fields,
      beforeStage: before.stage || null,
      afterStage: after.stage || null,
    },
  })
}
