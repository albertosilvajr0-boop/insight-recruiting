import { describe, expect, it } from 'vitest'
import {
  DECISION_HISTORY_LIMIT,
  DECISION_OUTCOMES,
  buildDecisionEntry,
  buildDecisionHistory,
  buildDecisionReasonRows,
  normalizeDecisionReason,
} from './decisionReasons'

describe('decision rationale helpers', () => {
  it('normalizes unknown reason codes to the first reason for the outcome', () => {
    const reason = normalizeDecisionReason(DECISION_OUTCOMES.REJECTED, 'not_real')

    expect(reason.code).toBe('minimum_requirements_not_met')
  })

  it('builds stable decision entries without undefined Firestore fields', () => {
    const entry = buildDecisionEntry({
      outcome: DECISION_OUTCOMES.HIRED,
      stage: 'hired',
      reasonCode: 'meets_role_criteria',
      note: 'Strong evidence across the structured review.',
      candidate: { selectionProcessVersion: '2026-04-30.1' },
      actor: { uid: 'admin-1', email: 'admin@example.com' },
      decidedAt: new Date('2026-04-30T12:00:00.000Z'),
    })

    expect(entry).toMatchObject({
      outcome: 'hired',
      stage: 'hired',
      reasonCode: 'meets_role_criteria',
      selectionProcessVersion: '2026-04-30.1',
      decidedAt: '2026-04-30T12:00:00.000Z',
      decidedBy: { uid: 'admin-1', email: 'admin@example.com' },
    })
  })

  it('keeps decision history capped to the configured limit', () => {
    const existing = Array.from({ length: DECISION_HISTORY_LIMIT }, (_, i) => ({ id: `old-${i}` }))
    const history = buildDecisionHistory(existing, { id: 'new' })

    expect(history).toHaveLength(DECISION_HISTORY_LIMIT)
    expect(history[0].id).toBe('old-1')
    expect(history.at(-1).id).toBe('new')
  })

  it('aggregates latest decision reasons for analytics', () => {
    const rows = buildDecisionReasonRows([
      {
        stage: 'rejected',
        latestDecision: {
          outcome: 'rejected',
          reasonCode: 'minimum_requirements_not_met',
          reasonLabel: 'Does not meet job-related minimum requirements',
          decidedAt: '2026-04-30T12:00:00.000Z',
        },
      },
      {
        stage: 'hired',
        latestDecision: {
          outcome: 'hired',
          reasonCode: 'meets_role_criteria',
          reasonLabel: 'Meets job-related role criteria',
          decidedAt: '2026-04-30T12:00:00.000Z',
        },
      },
      {
        stage: 'rejected',
        latestDecision: {
          outcome: 'rejected',
          reasonCode: 'minimum_requirements_not_met',
          reasonLabel: 'Does not meet job-related minimum requirements',
          decidedAt: '2026-04-30T12:00:00.000Z',
        },
      },
    ])

    expect(rows[0]).toMatchObject({
      outcome: 'rejected',
      reasonCode: 'minimum_requirements_not_met',
      count: 2,
      rejectedCount: 2,
    })
    expect(rows[1]).toMatchObject({
      outcome: 'hired',
      count: 1,
      hiredCount: 1,
    })
  })
})
