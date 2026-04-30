import { describe, expect, it } from 'vitest'
import {
  buildOutcomeSegmentRows,
  buildPerformanceRecords,
  buildSignalCorrelationRows,
  checkpointOutcome,
  pearsonCorrelation,
} from './performanceCorrelation'

describe('performance correlation helpers', () => {
  it('averages completed performance checkpoints only', () => {
    const outcome = checkpointOutcome({
      day30: { completed: true, rating: 4 },
      day60: { completed: true, rating: 5 },
      day90: { completed: false, rating: 2 },
    })

    expect(outcome.ratingCount).toBe(2)
    expect(outcome.averageRating).toBe(4.5)
    expect(outcome.latestRating).toBe(5)
    expect(outcome.completedKeys).toEqual(['day30', 'day60'])
  })

  it('joins onboarding outcomes back to candidate selection signals', () => {
    const records = buildPerformanceRecords([
      { id: 'candidate-1', candidateId: 'uuid-1', firstName: 'Ada', jobTitle: 'BDC Agent', compositeScore: 8.5 },
    ], [
      {
        id: 'candidate-1',
        candidateDocId: 'candidate-1',
        performanceCheckpoints: { day30: { completed: true, rating: 4 } },
      },
    ])

    expect(records).toHaveLength(1)
    expect(records[0].candidate.compositeScore).toBe(8.5)
    expect(records[0].outcome.averageRating).toBe(4)
  })

  it('calculates Pearson correlation', () => {
    expect(pearsonCorrelation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1)
    expect(pearsonCorrelation([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1)
  })

  it('builds signal correlation rows with sample-size safeguards', () => {
    const records = [
      performanceRecord(1, 2),
      performanceRecord(2, 3),
      performanceRecord(3, 4),
    ]

    const rows = buildSignalCorrelationRows(records, 3)
    const manual = rows.find((row) => row.key === 'manual')

    expect(manual.sampleSize).toBe(3)
    expect(manual.coefficient).toBeCloseTo(1)
    expect(manual.strength).toBe('strong_positive')
  })

  it('aggregates outcome segments by role', () => {
    const rows = buildOutcomeSegmentRows([
      { role: 'BDC Agent', outcome: { averageRating: 4 }, candidate: { manualScore: { avg: 4 }, compositeScore: 8 } },
      { role: 'BDC Agent', outcome: { averageRating: 5 }, candidate: { manualScore: { avg: 5 }, compositeScore: 9 } },
    ], 'role')

    expect(rows).toEqual([
      {
        label: 'BDC Agent',
        sampleSize: 2,
        averageOutcome: 4.5,
        topPerformerCount: 2,
        averageManualScore: 4.5,
        averageCompositeScore: 8.5,
      },
    ])
  })
})

function performanceRecord(score, outcome) {
  return {
    candidate: {
      manualScore: { avg: score },
      compositeScore: score,
      resumeScore: score,
      interviewScore: score,
    },
    outcome: { averageRating: outcome },
  }
}
