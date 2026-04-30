export const SELECTION_PROCESS_VERSION = '2026-04-30.1'
export const COMPLIANCE_NOTICE_VERSION = '2026-04-30.1'
export const EEO_SURVEY_VERSION = '2026-04-30.1'
export const COMPLIANCE_CONTACT_EMAIL = import.meta.env.VITE_RECRUITING_COMPLIANCE_EMAIL
  || 'albertosilva@silvaconsultinggroup.com'

export const EEO_OPTIONS = Object.freeze({
  gender: [
    'Prefer not to say',
    'Woman',
    'Man',
    'Non-binary',
    'Self-describe',
  ],
  raceEthnicity: [
    'Prefer not to say',
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
    label: 'I understand the selection process notice.',
  },
  {
    key: 'aiReviewAccepted',
    label: 'I understand technology may help organize or evaluate application materials, and hiring decisions remain subject to human review.',
  },
  {
    key: 'accuracyCertified',
    label: 'I certify that the information I submit is accurate, and I will not include medical or disability details in my resume or interview answers.',
  },
])

export const DEFAULT_ACKNOWLEDGEMENTS = Object.freeze(
  REQUIRED_ACKNOWLEDGEMENTS.reduce((acc, item) => ({ ...acc, [item.key]: false }), {})
)

export const DEFAULT_EEO_SURVEY = Object.freeze({
  optedIn: false,
  gender: 'Prefer not to say',
  raceEthnicity: 'Prefer not to say',
})

export function allRequiredAcknowledgementsAccepted(acknowledgements) {
  return REQUIRED_ACKNOWLEDGEMENTS.every((item) => acknowledgements?.[item.key] === true)
}

export function normalizeEeoSurvey(survey) {
  if (!survey?.optedIn) return { ...DEFAULT_EEO_SURVEY }
  return {
    optedIn: true,
    gender: EEO_OPTIONS.gender.includes(survey.gender) ? survey.gender : DEFAULT_EEO_SURVEY.gender,
    raceEthnicity: EEO_OPTIONS.raceEthnicity.includes(survey.raceEthnicity)
      ? survey.raceEthnicity
      : DEFAULT_EEO_SURVEY.raceEthnicity,
  }
}
