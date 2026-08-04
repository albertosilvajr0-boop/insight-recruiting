import { describe, expect, it } from 'vitest'
import {
  canChangeCandidateJob,
  candidateProfileError,
  candidateProfileForm,
} from './candidateProfile'

describe('candidate profile editing helpers', () => {
  it('builds an editable form from an existing profile', () => {
    expect(candidateProfileForm({
      firstName: '  Ryan ',
      lastName: 'McCormick',
      email: 'ryan@example.com',
      phone: '303-555-0100',
      jobId: 'service-advisor',
    })).toEqual({
      firstName: '  Ryan ',
      lastName: 'McCormick',
      email: 'ryan@example.com',
      phone: '303-555-0100',
      jobId: 'service-advisor',
    })
  })

  it('validates required fields and email format', () => {
    const valid = {
      firstName: 'Ryan',
      lastName: 'McCormick',
      email: 'ryan@example.com',
      phone: '303-555-0100',
      jobId: 'service-advisor',
    }

    expect(candidateProfileError(valid)).toBeNull()
    expect(candidateProfileError({ ...valid, email: 'not-an-email' })).toBe('Enter a valid email address.')
    expect(candidateProfileError({ ...valid, phone: ' ' })).toBe('Phone number is required.')
  })

  it('only allows job changes before the candidate opens the interview', () => {
    expect(canChangeCandidateJob({ stage: 'invited' })).toBe(true)
    expect(canChangeCandidateJob({ stage: 'invited', firstSignInAt: { seconds: 1 } })).toBe(false)
    expect(canChangeCandidateJob({ stage: 'invited', questions: { 0: { text: 'Intro' } } })).toBe(false)
    expect(canChangeCandidateJob({ stage: 'applied' })).toBe(false)
  })
})
