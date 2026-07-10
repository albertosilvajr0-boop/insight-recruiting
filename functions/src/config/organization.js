export const APP_URL = process.env.PUBLIC_BASE_URL
  || process.env.APP_URL
  || process.env.VITE_APP_URL
  || 'https://insight-recruiting-d37dc.web.app'

export const PLATFORM_NAME = process.env.PLATFORM_NAME
  || process.env.VITE_PLATFORM_NAME
  || 'Insight Recruiting'

export const DEFAULT_CLIENT_NAME = process.env.CLIENT_DISPLAY_NAME
  || process.env.VITE_CLIENT_DISPLAY_NAME
  || PLATFORM_NAME

export const DEFAULT_JOB_LOCATION = process.env.RECRUITING_JOB_LOCATION
  || process.env.VITE_RECRUITING_JOB_LOCATION
  || 'Client site or remote'

export const DEFAULT_TIME_ZONE = process.env.RECRUITING_TIME_ZONE || 'America/Denver'
export const DEFAULT_JOB_CATEGORY = process.env.RECRUITING_JOB_CATEGORY || 'General'
export const EMAIL_SENDER_NAME = process.env.EMAIL_SENDER_NAME || DEFAULT_CLIENT_NAME
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL
  || process.env.GMAIL_SENDER
  || 'albertosilva@silvaconsultinggroup.com'

export function getCandidateClientName(candidate = {}) {
  return candidate.clientName || candidate.organizationName || candidate.companyName || DEFAULT_CLIENT_NAME
}

export function getCandidateJobLocation(candidate = {}) {
  return candidate.location || candidate.jobLocation || DEFAULT_JOB_LOCATION
}

export function getJobClientName(job = {}) {
  return job.clientName || job.organizationName || job.companyName || DEFAULT_CLIENT_NAME
}

export function getJobLocation(job = {}) {
  return job.location || job.jobLocation || DEFAULT_JOB_LOCATION
}
