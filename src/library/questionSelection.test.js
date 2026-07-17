import { describe, expect, it } from 'vitest'
import { questionsFromStoredMap, selectQuestionsForRole } from './questionSelection'

describe('question selection', () => {
  it('uses the latest standalone role battery without legacy universal questions', () => {
    const questions = [
      { id: 'all-1', roleKey: 'all', text: 'Legacy universal', type: 'video_response', active: true, order: 0 },
      { id: 'server-old', roleKey: 'server', text: 'Legacy server', type: 'video_response', active: true, order: 800 },
      { id: 'server-v2-1', roleKey: 'server', text: 'Server V2 intro', type: 'video_response', active: true, order: 800, questionSetVersion: '2026-07-v2', standaloneRoleBattery: true },
      { id: 'server-v2-2', roleKey: 'server', text: 'Server V2 math', type: 'text_response', active: true, order: 801, questionSetVersion: '2026-07-v2', standaloneRoleBattery: true },
    ]

    expect(selectQuestionsForRole(questions, 'server').map(q => q.id)).toEqual(['server-v2-1', 'server-v2-2'])
  })

  it('keeps universal questions for legacy role batteries', () => {
    const questions = [
      { id: 'all-1', roleKey: 'all', text: 'Universal intro', type: 'video_response', active: true, order: 0 },
      { id: 'sales-1', roleKey: 'sales-rep', text: 'Sales scenario', type: 'video_response', active: true, order: 20 },
    ]

    expect(selectQuestionsForRole(questions, 'sales-rep').map(q => q.id)).toEqual(['all-1', 'sales-1'])
  })

  it('restores reopened questions from the stored candidate map', () => {
    const restored = questionsFromStoredMap({
      1: { questionId: 'q2', text: 'Second', type: 'text_response', category: 'competence', timerType: 'hard', timerSeconds: 45 },
      0: { questionId: 'q1', text: 'First', type: 'video_response', category: 'intro' },
    })

    expect(restored.map(q => q.id)).toEqual(['q1', 'q2'])
    expect(restored[1]).toMatchObject({
      text: 'Second',
      type: 'text_response',
      category: 'competence',
      timerType: 'hard',
      timerSeconds: 45,
      fromStoredQuestionMap: true,
    })
  })
})
