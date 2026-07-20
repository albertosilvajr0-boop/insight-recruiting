export const DECISION_OUTCOMES = Object.freeze({
  ADVANCED: 'advanced',
  HIRED: 'hired',
  REJECTED: 'rejected',
  RESTORED: 'restored',
})

export const DECISION_HISTORY_LIMIT = 25

export const DECISION_REASON_SETS = Object.freeze({
  [DECISION_OUTCOMES.ADVANCED]: Object.freeze([
    { code: 'structured_review_complete', label: 'Structured review supports next step' },
    { code: 'human_review_override', label: 'Human review overrides automation' },
    { code: 'additional_review_needed', label: 'Advance for additional review' },
  ]),
  [DECISION_OUTCOMES.HIRED]: Object.freeze([
    { code: 'meets_role_criteria', label: 'Meets job-related role criteria' },
    { code: 'strongest_available_candidate', label: 'Strongest available candidate for current opening' },
    { code: 'validated_experience_match', label: 'Experience and interview evidence match role needs' },
  ]),
  [DECISION_OUTCOMES.REJECTED]: Object.freeze([
    { code: 'minimum_requirements_not_met', label: 'Does not meet job-related minimum requirements' },
    { code: 'incomplete_application', label: 'Incomplete application or missing required response' },
    { code: 'communication_evidence_below_bar', label: 'Interview evidence did not meet communication expectations' },
    { code: 'availability_mismatch', label: 'Availability or timing constraint' },
    { code: 'candidate_withdrew', label: 'Candidate withdrew or stopped responding' },
    { code: 'stronger_candidate_selected', label: 'Selected stronger candidate for current opening' },
    { code: 'other_job_related', label: 'Other job-related reason' },
  ]),
  [DECISION_OUTCOMES.RESTORED]: Object.freeze([
    { code: 'reopened_for_review', label: 'Reopened for additional review' },
    { code: 'candidate_reengaged', label: 'Candidate re-engaged' },
    { code: 'decision_correction', label: 'Corrected previous decision' },
  ]),
})

export function getDecisionReasons(outcome) {
  return DECISION_REASON_SETS[outcome] || DECISION_REASON_SETS[DECISION_OUTCOMES.ADVANCED]
}

export function normalizeDecisionReason(outcome, reasonCode) {
  const reasons = getDecisionReasons(outcome)
  return reasons.find((reason) => reason.code === reasonCode) || reasons[0]
}

export function buildDecisionEntry({
  outcome,
  stage,
  reasonCode,
  note,
  candidate,
  actor,
  decidedAt = new Date(),
}) {
  const normalizedOutcome = Object.values(DECISION_OUTCOMES).includes(outcome)
    ? outcome
    : DECISION_OUTCOMES.ADVANCED
  const reason = normalizeDecisionReason(normalizedOutcome, reasonCode)
  const rawDecidedAtDate = decidedAt instanceof Date ? decidedAt : new Date(decidedAt)
  const decidedAtDate = Number.isNaN(rawDecidedAtDate.getTime()) ? new Date() : rawDecidedAtDate
  const cleanedNote = String(note || '').trim().slice(0, 600)

  return {
    id: `${normalizedOutcome}_${stage || 'unknown'}_${decidedAtDate.getTime()}`,
    outcome: normalizedOutcome,
    stage: stage || null,
    reasonCode: reason.code,
    reasonLabel: reason.label,
    note: cleanedNote,
    selectionProcessVersion: candidate?.selectionProcessVersion || null,
    decidedAt: decidedAtDate.toISOString(),
    decidedBy: {
      uid: actor?.uid || null,
      email: actor?.email || null,
    },
  }
}

export function buildDecisionHistory(existingHistory, entry, limit = DECISION_HISTORY_LIMIT) {
  const existing = Array.isArray(existingHistory) ? existingHistory : []
  return [...existing, entry].slice(-limit)
}

export function buildDecisionReasonRows(candidates, { startDate } = {}) {
  const startTime = startDate instanceof Date ? startDate.getTime() : null
  const rowsByKey = new Map()

  for (const candidate of candidates || []) {
    const decision = candidate.latestDecision
    if (!decision?.reasonCode) continue

    const decidedAt = decision.decidedAt ? new Date(decision.decidedAt) : null
    if (startTime && (!decidedAt || Number.isNaN(decidedAt.getTime()) || decidedAt.getTime() < startTime)) {
      continue
    }

    const key = `${decision.outcome || 'unknown'}:${decision.reasonCode}`
    const row = rowsByKey.get(key) || {
      key,
      outcome: decision.outcome || 'unknown',
      reasonCode: decision.reasonCode,
      reasonLabel: decision.reasonLabel || decision.reasonCode,
      count: 0,
      hiredCount: 0,
      rejectedCount: 0,
      advancedCount: 0,
    }

    row.count += 1
    if (candidate.stage === 'hired' || decision.outcome === DECISION_OUTCOMES.HIRED) row.hiredCount += 1
    if (candidate.stage === 'rejected' || decision.outcome === DECISION_OUTCOMES.REJECTED) row.rejectedCount += 1
    if (decision.outcome === DECISION_OUTCOMES.ADVANCED) row.advancedCount += 1
    rowsByKey.set(key, row)
  }

  return Array.from(rowsByKey.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return a.reasonLabel.localeCompare(b.reasonLabel)
  })
}
