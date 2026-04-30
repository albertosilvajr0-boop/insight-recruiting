import { describe, expect, it } from 'vitest'
import {
  buildInitialOnboardingDoc,
  checkpointProgress,
  dueDateForRule,
  dueStatus,
  overdueItemCount,
  taskProgress,
} from './plan'

describe('onboarding plan helpers', () => {
  it('builds a new onboarding record from a hired candidate', () => {
    const doc = buildInitialOnboardingDoc({
      id: 'candidate-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      jobTitle: 'BDC Agent',
    }, { uid: 'admin-1', email: 'admin@example.com' }, 'now')

    expect(doc.candidateId).toBe('candidate-1')
    expect(doc.candidateDocId).toBe('candidate-1')
    expect(doc.candidateName).toBe('Ada Lovelace')
    expect(doc.status).toBe('active')
    expect(doc.ownerEmail).toBe('admin@example.com')
    expect(taskProgress(doc.tasks)).toEqual({ total: 11, completed: 0, pct: 0 })
    expect(checkpointProgress(doc.performanceCheckpoints)).toEqual({ total: 3, completed: 0, pct: 0 })
  })

  it('calculates I-9 Section 2 due date using business days', () => {
    const due = dueDateForRule('2026-05-01', { type: 'business_days_after_start', days: 3 })
    expect(formatDate(due)).toBe('2026-05-06')
  })

  it('reports overdue, due soon, upcoming, and complete states', () => {
    const today = new Date(2026, 4, 10)

    expect(dueStatus({ completed: false }, '2026-05-01', { type: 'days_after_start', days: 7 }, today)).toBe('overdue')
    expect(dueStatus({ completed: false }, '2026-05-10', { type: 'days_after_start', days: 3 }, today)).toBe('due_soon')
    expect(dueStatus({ completed: false }, '2026-05-10', { type: 'days_after_start', days: 10 }, today)).toBe('upcoming')
    expect(dueStatus({ completed: true }, '2026-05-01', { type: 'days_after_start', days: 7 }, today)).toBe('complete')
  })

  it('counts overdue tasks and checkpoints together', () => {
    const doc = buildInitialOnboardingDoc({ id: 'candidate-1' })
    const count = overdueItemCount({ ...doc, startDate: '2026-05-01' }, new Date(2026, 4, 20))

    expect(count).toBeGreaterThan(0)
  })
})

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}
