import { describe, it, expect } from 'vitest'
import questions from '../../interviewQuestions_seed.json'
import rubrics from '../../roleRubrics_seed.json'
import { INDUSTRY_OPTIONS } from '../config/industries'

const QUESTION_TYPES = ['video_response', 'video_reading', 'text_response']
const CATEGORIES = ['intro', 'experience', 'situational', 'word_track', 'competence', 'motivation', 'values', 'communication']
const TIMER_TYPES = ['none', 'hard', 'soft']

describe('interview battery seed data', () => {
  it('contains 14 rubrics and 149 questions', () => {
    expect(rubrics).toHaveLength(14)
    expect(questions).toHaveLength(149)
  })

  it('every question matches the interviewQuestions schema', () => {
    for (const q of questions) {
      expect(q.text.length).toBeGreaterThan(0)
      expect(QUESTION_TYPES).toContain(q.type)
      expect(CATEGORIES).toContain(q.category)
      expect(TIMER_TYPES).toContain(q.timerType)
      expect(q.active).toBe(true)
      if (q.timerType === 'none') expect(q.timerSeconds).toBe(0)
      else expect(q.timerSeconds).toBeGreaterThan(0)
    }
  })

  it('orders are unique and do not clash with built-in seeds (orders 0-40)', () => {
    const orders = questions.map((q) => q.order)
    expect(new Set(orders).size).toBe(orders.length)
    expect(Math.min(...orders)).toBeGreaterThanOrEqual(100)
  })

  it('every question belongs to a rubric role and carries its industry', () => {
    const byKey = Object.fromEntries(rubrics.map((r) => [r.roleKey, r]))
    for (const q of questions) {
      expect(byKey[q.roleKey], `rubric for ${q.roleKey}`).toBeDefined()
      expect(q.industry).toBe(byKey[q.roleKey].industry)
    }
  })

  it('every rubric has valid weights, disqualifiers, and a known industry label', () => {
    for (const r of rubrics) {
      expect(r.label.length).toBeGreaterThan(0)
      expect(INDUSTRY_OPTIONS).toContain(r.industryLabel)
      const total = Object.values(r.scoringWeights).reduce((a, b) => a + b, 0)
      expect(total, `${r.roleKey} weights`).toBe(100)
      expect(r.hardDisqualifiers.length).toBeGreaterThan(0)
    }
  })

  it('all four industries have at least one role', () => {
    const industries = new Set(rubrics.map((r) => r.industryLabel))
    expect([...industries].sort()).toEqual([...INDUSTRY_OPTIONS].sort())
  })
})
