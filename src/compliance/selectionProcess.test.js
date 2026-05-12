import { describe, expect, it } from 'vitest'
import {
  EEO_OPTIONS,
  buildRenderedSelectionNoticeText,
  getTechnologyCapabilitySentence,
  normalizeEeoSurvey,
} from './selectionProcess'

describe('selection process notice helpers', () => {
  it('does not retain demographic field values when EEO sharing is unchecked', () => {
    expect(normalizeEeoSurvey({
      optedIn: false,
      gender: 'Woman',
      raceEthnicity: 'Hispanic or Latino',
    })).toEqual({
      optedIn: false,
      status: 'not_provided',
    })
  })

  it('allows prefer-not-to-answer values when EEO sharing is checked', () => {
    expect(EEO_OPTIONS.gender[0]).toBe('Prefer not to answer')
    expect(normalizeEeoSurvey({
      optedIn: true,
      gender: 'Prefer not to answer',
      raceEthnicity: 'Prefer not to answer',
    })).toEqual({
      optedIn: true,
      status: 'provided',
      gender: 'Prefer not to answer',
      raceEthnicity: 'Prefer not to answer',
    })
  })

  it('only describes capabilities that are enabled', () => {
    const sentence = getTechnologyCapabilitySentence({
      transcribe: false,
      organize: true,
      summarize: false,
      evaluateWithRubric: false,
      generateScores: false,
    })

    expect(sentence).not.toContain('transcribe')
    expect(sentence).not.toContain('summarize')
    expect(sentence).not.toContain('scores')
    expect(sentence).toContain('organize')
  })

  it('renders the verified employer and parent organization names', () => {
    const notice = buildRenderedSelectionNoticeText('Sales Consultant')

    expect(notice).toContain('San Antonio Dodge Chrysler Jeep RAM')
    expect(notice).toContain('Greenway Automotive Organization')
    expect(notice).toContain('Sales Consultant')
  })
})
