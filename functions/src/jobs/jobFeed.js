import { getFirestore } from 'firebase-admin/firestore'
import { format } from 'date-fns'
import {
  APP_URL,
  DEFAULT_CLIENT_NAME,
  DEFAULT_JOB_CATEGORY,
  getJobClientName,
  getJobLocation,
} from '../config/organization.js'

export async function generateJobFeed() {
  const db = getFirestore()
  const snap = await db.collection('jobs')
    .where('status', '==', 'active')
    .orderBy('createdAt', 'desc')
    .get()

  const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }))

  const jobEntries = jobs.map(job => {
    const posted = job.createdAt?.toDate?.() || new Date()
    const company = getJobClientName(job)
    const location = getJobLocation(job)
    const description = job.description || `${job.title} position at ${company}`

    return `
    <job>
      <title><![CDATA[${job.title}]]></title>
      <date>${format(posted, 'yyyy-MM-dd')}</date>
      <referencenumber>${job.id}</referencenumber>
      <url>${APP_URL}/apply/${job.id}</url>
      <company><![CDATA[${company}]]></company>
      <city><![CDATA[${job.city || ''}]]></city>
      <state><![CDATA[${job.state || ''}]]></state>
      <country>US</country>
      <postalcode><![CDATA[${job.postalCode || ''}]]></postalcode>
      <streetaddress><![CDATA[${location}]]></streetaddress>
      <description><![CDATA[${description}]]></description>
      <salary>${job.payRange ? `$${job.payRange.min?.toLocaleString()} - $${job.payRange.max?.toLocaleString()} per year` : 'Competitive'}</salary>
      <jobtype>fulltime</jobtype>
      <category><![CDATA[${job.category || DEFAULT_JOB_CATEGORY}]]></category>
      <experience>Entry Level to Mid Level</experience>
    </job>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<source>
  <publisher>${DEFAULT_CLIENT_NAME}</publisher>
  <publisherurl>${APP_URL}</publisherurl>
  <lastBuildDate>${format(new Date(), "EEE, dd MMM yyyy HH:mm:ss 'GMT'")}</lastBuildDate>
${jobEntries}
</source>`
}
