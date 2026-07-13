import { APP_URL, getJobClientName } from '../config/organization'

const DAY_MS = 24 * 60 * 60 * 1000
const VALID_DAYS = 60

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'TEMPORARY']
export const DEFAULT_EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME']

function toDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function isoDate(date) {
  return date.toISOString().split('T')[0]
}

function stripHtml(text) {
  return String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Google requires unitText to match how the pay range is actually quoted.
// Older job docs predate the payUnit field — a max under $1,000 can only be
// an hourly rate.
export function inferPayUnit(job) {
  if (job.payUnit === 'HOUR' || job.payUnit === 'YEAR') return job.payUnit
  const max = Number(job.payRange?.max)
  return Number.isFinite(max) && max < 1000 ? 'HOUR' : 'YEAR'
}

function parseAddress(job) {
  const address = {
    '@type': 'PostalAddress',
    addressLocality: 'Centennial',
    addressRegion: 'CO',
    addressCountry: 'US',
  }
  if (job.streetAddress) address.streetAddress = job.streetAddress
  if (job.postalCode) address.postalCode = job.postalCode

  const location = String(job.location || '').trim()
  if (location && !/remote|client site/i.test(location)) {
    const [locality, region] = location.split(',').map(s => s.trim())
    if (locality) address.addressLocality = locality
    if (region && /^[A-Za-z]{2}$/.test(region)) address.addressRegion = region.toUpperCase()
  }
  return address
}

export function buildJobPostingJsonLd(job) {
  const organization = job.organizationName || job.clientName || getJobClientName(job)
  const created = toDate(job.createdAt) || new Date()
  const description = job.description
    ? stripHtml(job.description)
    : `${job.title} position at ${organization}. Apply online in minutes.`

  const jsonLd = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description,
    datePosted: isoDate(created),
    validThrough: new Date(created.getTime() + VALID_DAYS * DAY_MS).toISOString(),
    hiringOrganization: {
      '@type': 'Organization',
      name: organization,
      sameAs: APP_URL,
      logo: `${APP_URL}/logo.png`,
    },
    jobLocation: {
      '@type': 'Place',
      address: parseAddress(job),
    },
    employmentType: Array.isArray(job.employmentType) && job.employmentType.length > 0
      ? job.employmentType
      : DEFAULT_EMPLOYMENT_TYPES,
    identifier: {
      '@type': 'PropertyValue',
      name: organization,
      value: job.id,
    },
    directApply: true,
  }

  const min = Number(job.payRange?.min)
  const max = Number(job.payRange?.max)
  if (Number.isFinite(min) && Number.isFinite(max)) {
    jsonLd.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        minValue: min,
        maxValue: max,
        unitText: inferPayUnit(job),
      },
    }
  }

  return jsonLd
}
