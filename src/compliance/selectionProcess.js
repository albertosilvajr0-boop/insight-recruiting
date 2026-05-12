export const SELECTION_PROCESS_VERSION = '2026-05-12.1'
export const COMPLIANCE_NOTICE_VERSION = '2026-05-12.1'
export const EEO_SURVEY_VERSION = '2026-05-12.1'

export const EMPLOYER_DISPLAY_NAME = import.meta.env.VITE_EMPLOYER_DISPLAY_NAME
  || 'San Antonio Dodge Chrysler Jeep RAM'
export const EMPLOYER_SHORT_NAME = import.meta.env.VITE_EMPLOYER_SHORT_NAME
  || 'San Antonio Dodge'
export const PARENT_ORG_DISPLAY_NAME = import.meta.env.VITE_PARENT_ORG_DISPLAY_NAME
  || 'Greenway Automotive Organization'
export const EMPLOYER_LEGAL_NAME = import.meta.env.VITE_EMPLOYER_LEGAL_NAME || ''
export const JOB_LOCATION = import.meta.env.VITE_RECRUITING_JOB_LOCATION
  || '11910 N IH 35, San Antonio, TX 78233-4200'
export const APPLICANT_PRIVACY_URL = import.meta.env.VITE_APPLICANT_PRIVACY_URL
  || 'https://www.sanantoniododgechryslerjeepram.com/san-antonio-cdjr-privacy-policy/'
export const VENDOR_DISPLAY_NAME = import.meta.env.VITE_INTERVIEW_VENDOR_DISPLAY_NAME
  || 'Paycom'
export const ACCOMMODATION_EMAIL = import.meta.env.VITE_RECRUITING_ACCOMMODATION_EMAIL || ''
export const ACCOMMODATION_PHONE = import.meta.env.VITE_RECRUITING_ACCOMMODATION_PHONE
  || '210-239-1402'

export const ENABLED_INTERVIEW_CAPABILITIES = Object.freeze({
  transcribe: true,
  organize: true,
  summarize: false,
  evaluateWithRubric: true,
  generateScores: true,
  recordAudio: true,
  recordVideo: true,
})

export const EEO_OPTIONS = Object.freeze({
  gender: [
    'Prefer not to answer',
    'Woman',
    'Man',
    'Non-binary',
    'Self-describe',
  ],
  raceEthnicity: [
    'Prefer not to answer',
    'Hispanic or Latino',
    'American Indian or Alaska Native',
    'Asian',
    'Black or African American',
    'Native Hawaiian or Other Pacific Islander',
    'White',
    'Two or more races',
    'Self-describe',
  ],
})

export const REQUIRED_ACKNOWLEDGEMENTS = Object.freeze([
  {
    key: 'processNoticeAccepted',
    label: 'I understand my application materials and interview responses will be reviewed against job-related requirements for this role.',
  },
  {
    key: 'aiReviewAccepted',
    label: 'I understand interview technology may help transcribe, organize, and evaluate my application materials and interview responses using a role-specific rubric, and that final selection decisions are made by human reviewers.',
  },
  {
    key: 'accuracyCertified',
    label: 'I certify that the information I submit is accurate to the best of my knowledge. I understand I should avoid including non-job-related medical, disability, genetic information, family medical history, or other protected personal details in my resume or interview responses, except as needed to request a reasonable accommodation through the accommodation process.',
  },
])

export const DEFAULT_ACKNOWLEDGEMENTS = Object.freeze(
  REQUIRED_ACKNOWLEDGEMENTS.reduce((acc, item) => ({ ...acc, [item.key]: false }), {})
)

export const DEFAULT_EEO_SURVEY = Object.freeze({
  optedIn: false,
  status: 'not_provided',
  gender: 'Prefer not to answer',
  raceEthnicity: 'Prefer not to answer',
})

export function allRequiredAcknowledgementsAccepted(acknowledgements) {
  return REQUIRED_ACKNOWLEDGEMENTS.every((item) => acknowledgements?.[item.key] === true)
}

export function normalizeEeoSurvey(survey) {
  if (!survey?.optedIn) return { optedIn: false, status: 'not_provided' }
  return {
    optedIn: true,
    status: 'provided',
    gender: EEO_OPTIONS.gender.includes(survey.gender) ? survey.gender : DEFAULT_EEO_SURVEY.gender,
    raceEthnicity: EEO_OPTIONS.raceEthnicity.includes(survey.raceEthnicity)
      ? survey.raceEthnicity
      : DEFAULT_EEO_SURVEY.raceEthnicity,
  }
}

export function getEmployerDisplayWithParent() {
  return `${EMPLOYER_DISPLAY_NAME}, part of ${PARENT_ORG_DISPLAY_NAME}`
}

export function getTechnologyCapabilitySentence(capabilities = ENABLED_INTERVIEW_CAPABILITIES) {
  const verbs = []
  if (capabilities.transcribe) verbs.push('transcribe')
  if (capabilities.organize) verbs.push('organize')
  if (capabilities.summarize) verbs.push('summarize')

  const capabilityText = formatList(verbs)
  const actionText = capabilities.evaluateWithRubric
    ? `${capabilityText ? `${capabilityText}, and ` : ''}evaluate responses using a role-specific rubric`
    : capabilityText || 'support human review'

  const outputs = []
  if (capabilities.organize) outputs.push('structured notes')
  if (capabilities.generateScores) outputs.push('scores')

  return `Interview technology may help ${actionText}. It may generate ${formatList(outputs) || 'review materials'} for human review.`
}

export function getRecordingNotice(capabilities = ENABLED_INTERVIEW_CAPABILITIES) {
  const media = []
  if (capabilities.recordAudio) media.push('audio')
  if (capabilities.recordVideo) media.push('video')
  if (media.length === 0) return ''
  return `Some interview questions may record ${formatList(media)} so your responses can be reviewed.`
}

export function buildRenderedSelectionNoticeText(jobTitle = 'this role') {
  const lines = [
    'Review the selection process',
    `Please review these notices before starting your interview for ${jobTitle} with ${getEmployerDisplayWithParent()}.`,
    'How your application is reviewed',
    'Your application materials and interview responses are reviewed against job-related requirements for this role.',
    getTechnologyCapabilitySentence(),
    'The technology does not make final hiring decisions. Human reviewers remain responsible for selection decisions.',
    'Optional EEO information, if you choose to provide it, is stored separately, hidden from hiring reviewers, and not used to evaluate your application.',
    'Please avoid including non-job-related medical, disability, genetic information, family medical history, or other protected personal details in your resume or interview responses. This does not limit your right to request a reasonable accommodation.',
    getRecordingNotice(),
    ...REQUIRED_ACKNOWLEDGEMENTS.map((item) => item.label),
  ].filter(Boolean)
  return lines.join('\n')
}

function formatList(items) {
  if (!items.length) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}
