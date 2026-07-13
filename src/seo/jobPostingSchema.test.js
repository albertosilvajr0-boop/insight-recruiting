import { describe, it, expect } from 'vitest'
import { buildJobPostingJsonLd, inferPayUnit } from './jobPostingSchema'

const hourlyJob = {
  id: 'job-hourly-1',
  title: 'Service Advisor',
  clientName: 'McDonald Automotive',
  organizationName: 'McDonald Automotive',
  location: 'Littleton, CO',
  description: '<p>Front-line service advisor for a busy drive lane.</p>',
  payRange: { min: 18, max: 26 },
  payUnit: 'HOUR',
  employmentType: ['FULL_TIME'],
  createdAt: new Date('2026-07-01T12:00:00Z'),
}

const legacyYearlyJob = {
  id: 'job-yearly-1',
  title: 'Restaurant General Manager',
  clientName: 'Iron Table Hospitality',
  location: 'Centennial, CO',
  payRange: { min: 65000, max: 90000 },
  // no payUnit, no employmentType — a pre-migration doc
  createdAt: new Date('2026-06-15T12:00:00Z'),
}

describe('JobPosting JSON-LD', () => {
  it('includes every Google-required field', () => {
    for (const job of [hourlyJob, legacyYearlyJob]) {
      const ld = buildJobPostingJsonLd(job)
      expect(ld['@type']).toBe('JobPosting')
      expect(ld.title).toBeTruthy()
      expect(ld.description).toBeTruthy()
      expect(ld.datePosted).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(ld.hiringOrganization?.name).toBeTruthy()
      expect(ld.jobLocation?.address?.addressLocality).toBeTruthy()
      expect(ld.jobLocation?.address?.addressRegion).toBeTruthy()
      expect(ld.jobLocation?.address?.addressCountry).toBe('US')
      // Recommended fields we always emit
      expect(new Date(ld.validThrough).getTime()).toBeGreaterThan(new Date(ld.datePosted).getTime())
      expect(ld.baseSalary?.value?.minValue).toBeGreaterThan(0)
      expect(ld.identifier?.value).toBe(job.id)
      expect(ld.directApply).toBe(true)
    }
  })

  it('strips HTML from descriptions', () => {
    const ld = buildJobPostingJsonLd(hourlyJob)
    expect(ld.description).toBe('Front-line service advisor for a busy drive lane.')
  })

  it('uses the stored payUnit and infers HOUR for legacy sub-$1000 ranges', () => {
    expect(buildJobPostingJsonLd(hourlyJob).baseSalary.value.unitText).toBe('HOUR')
    expect(buildJobPostingJsonLd(legacyYearlyJob).baseSalary.value.unitText).toBe('YEAR')
    expect(inferPayUnit({ payRange: { min: 15, max: 22 } })).toBe('HOUR')
    expect(inferPayUnit({ payRange: { min: 40000, max: 60000 } })).toBe('YEAR')
    expect(inferPayUnit({ payUnit: 'YEAR', payRange: { min: 15, max: 22 } })).toBe('YEAR')
  })

  it('parses locality/region from the location string with sane defaults', () => {
    expect(buildJobPostingJsonLd(hourlyJob).jobLocation.address.addressLocality).toBe('Littleton')
    const remote = buildJobPostingJsonLd({ ...hourlyJob, location: 'Client site or remote' })
    expect(remote.jobLocation.address.addressLocality).toBe('Centennial')
    expect(remote.jobLocation.address.addressRegion).toBe('CO')
  })

  it('defaults employmentType and validThrough is +60 days', () => {
    const ld = buildJobPostingJsonLd(legacyYearlyJob)
    expect(ld.employmentType).toEqual(['FULL_TIME', 'PART_TIME'])
    const days = (new Date(ld.validThrough) - new Date('2026-06-15T12:00:00Z')) / 86400000
    expect(days).toBe(60)
  })

  it('sample output for manual review', () => {
    console.log(JSON.stringify(buildJobPostingJsonLd(hourlyJob), null, 2))
  })
})
