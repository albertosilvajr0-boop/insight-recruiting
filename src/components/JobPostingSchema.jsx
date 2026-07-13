import { useEffect } from 'react'
import { buildJobPostingJsonLd } from '../seo/jobPostingSchema'

const SCRIPT_ID = 'job-posting-jsonld'

// Injects a single schema.org JobPosting into <head> for this job's page
// (Google requires the markup to live on the individual job page, not on
// list pages), plus a matching title and meta description. Everything is
// restored on unmount.
export default function JobPostingSchema({ job }) {
  useEffect(() => {
    if (!job?.title) return undefined

    const organization = job.organizationName || job.clientName || 'Insight Recruiting'

    document.getElementById(SCRIPT_ID)?.remove()
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.type = 'application/ld+json'
    script.textContent = JSON.stringify(buildJobPostingJsonLd(job))
    document.head.appendChild(script)

    const previousTitle = document.title
    document.title = `${job.title} - ${organization}`

    let meta = document.querySelector('meta[name="description"]')
    const createdMeta = !meta
    const previousDescription = meta?.getAttribute('content') ?? null
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'description')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content',
      `Apply for ${job.title} at ${organization}. Complete a short online application and video interview.`)

    return () => {
      document.getElementById(SCRIPT_ID)?.remove()
      document.title = previousTitle
      if (createdMeta) meta.remove()
      else if (previousDescription !== null) meta.setAttribute('content', previousDescription)
    }
  }, [job])

  return null
}
