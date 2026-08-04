const PROFILE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function hasEntries(value) {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length)
}

export function canChangeCandidateJob(candidate = {}) {
  if (candidate.stage !== 'invited') return false
  if (candidate.firstSignInAt || candidate.submittedAt || candidate.reopenedAt) return false

  return ![
    candidate.questions,
    candidate.videoResponses,
    candidate.textResponses,
    candidate.timingData,
  ].some(hasEntries)
}

export function candidateProfileForm(candidate = {}) {
  return {
    firstName: candidate.firstName || '',
    lastName: candidate.lastName || '',
    email: candidate.email || '',
    phone: candidate.phone || '',
    jobId: candidate.jobId || '',
  }
}

export function candidateProfileError(form = {}) {
  if (!String(form.firstName || '').trim()) return 'First name is required.'
  if (!String(form.lastName || '').trim()) return 'Last name is required.'
  if (!PROFILE_EMAIL_PATTERN.test(String(form.email || '').trim())) return 'Enter a valid email address.'
  if (!String(form.phone || '').trim()) return 'Phone number is required.'
  if (!String(form.jobId || '').trim()) return 'Choose a job opening.'
  return null
}
