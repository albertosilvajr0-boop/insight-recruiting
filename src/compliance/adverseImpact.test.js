import { describe, expect, it } from 'vitest'
import { buildSelectionRateRows, reachedSelectionMilestone } from './adverseImpact'

describe('selection rate monitoring', () => {
  it('recognizes candidates who reached the invitation milestone', () => {
    expect(reachedSelectionMilestone({ stage: 'applied' }, 'invited')).toBe(false)
    expect(reachedSelectionMilestone({ stage: 'scored' }, 'invited')).toBe(false)
    expect(reachedSelectionMilestone({ stage: 'to_schedule' }, 'invited')).toBe(true)
    expect(reachedSelectionMilestone({ stage: 'scheduled' }, 'invited')).toBe(true)
    expect(reachedSelectionMilestone({ stage: 'hired' }, 'invited')).toBe(true)
  })

  it('calculates selection rates and flags ratios below four-fifths', () => {
    const records = [
      ...makeRecords('Group A', 5, 5),
      ...makeRecords('Group B', 5, 3),
    ]

    const result = buildSelectionRateRows(records, 'raceEthnicity', { minGroupSize: 5 })
    const groupA = result.rows.find((row) => row.group === 'Group A')
    const groupB = result.rows.find((row) => row.group === 'Group B')

    expect(groupA.selectionRate).toBe(1)
    expect(groupA.status).toBe('ok')
    expect(groupB.selectionRate).toBe(0.6)
    expect(groupB.rateRatio).toBe(0.6)
    expect(groupB.status).toBe('attention')
  })

  it('keeps small groups visible without turning them into alerts', () => {
    const result = buildSelectionRateRows(makeRecords('Group C', 3, 0), 'gender', { minGroupSize: 5 })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].status).toBe('low_n')
    expect(result.rows[0].rateRatio).toBeNull()
  })

  it('does not include opt-outs or prefer-not-to-say responses', () => {
    const records = [
      {
        candidate: { stage: 'to_schedule' },
        compliance: {
          eeoSurvey: { optedIn: false, gender: 'Woman' },
        },
      },
      {
        candidate: { stage: 'to_schedule' },
        compliance: {
          eeoSurvey: { optedIn: true, gender: 'Prefer not to answer' },
        },
      },
    ]

    expect(buildSelectionRateRows(records, 'gender').rows).toEqual([])
  })
})

function makeRecords(group, applicants, selected) {
  return Array.from({ length: applicants }, (_, index) => ({
    candidate: { stage: index < selected ? 'to_schedule' : 'applied' },
    compliance: {
      eeoSurvey: {
        optedIn: true,
        raceEthnicity: group,
        gender: group,
      },
    },
  }))
}
