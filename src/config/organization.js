export const APP_URL = import.meta.env.VITE_APP_URL || 'https://insightedgehq.com'
export const PLATFORM_NAME = import.meta.env.VITE_PLATFORM_NAME || 'Insight Recruiting'
export const DEFAULT_CLIENT_NAME = import.meta.env.VITE_CLIENT_DISPLAY_NAME || PLATFORM_NAME
export const DEFAULT_CLIENT_INITIALS = import.meta.env.VITE_CLIENT_INITIALS || 'IR'
export const DEFAULT_JOB_LOCATION = import.meta.env.VITE_RECRUITING_JOB_LOCATION || 'Client site or remote'
export const DEFAULT_CONTACT_EMAIL = import.meta.env.VITE_RECRUITING_CONTACT_EMAIL || 'albertosilva@insightedgehq.com'
export const COPYRIGHT_ORG = import.meta.env.VITE_COPYRIGHT_ORG || 'Silva Consulting Group'

export function getJobClientName(job = {}) {
  return job.clientName || job.organizationName || job.companyName || DEFAULT_CLIENT_NAME
}

export function getJobLocation(job = {}) {
  return job.location || job.jobLocation || DEFAULT_JOB_LOCATION
}

export function getInitials(name = DEFAULT_CLIENT_NAME) {
  const initials = String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

  return initials || DEFAULT_CLIENT_INITIALS
}

export function getJobStructuredLocation(job = {}) {
  const location = getJobLocation(job)
  if (!location) return undefined

  return {
    '@type': 'Place',
    name: location,
  }
}
