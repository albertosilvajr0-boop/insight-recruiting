import { getFirestore } from 'firebase-admin/firestore'
import { format } from 'date-fns'

const APP_URL = process.env.VITE_APP_URL || 'https://insight-recruiting-d37dc.web.app'

export async function generateJobFeed() {
  const db = getFirestore()
  const snap = await db.collection('jobs')
    .where('status', '==', 'active')
    .orderBy('createdAt', 'desc')
    .get()

  const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }))

  const jobEntries = jobs.map(job => {
    const posted = job.createdAt?.toDate?.() || new Date()
    const description = job.description || `${job.title} position at San Antonio Dodge`

    return `
    <job>
      <title><![CDATA[${job.title}]]></title>
      <date>${format(posted, 'yyyy-MM-dd')}</date>
      <referencenumber>${job.id}</referencenumber>
      <url>${APP_URL}/apply/${job.id}</url>
      <company><![CDATA[San Antonio Dodge]]></company>
      <city>San Antonio</city>
      <state>TX</state>
      <country>US</country>
      <postalcode>78233-4200</postalcode>
      <streetaddress>11910 N IH 35</streetaddress>
      <description><![CDATA[${description}]]></description>
      <salary>${job.payRange ? `$${job.payRange.min?.toLocaleString()} - $${job.payRange.max?.toLocaleString()} per year` : 'Competitive'}</salary>
      <jobtype>fulltime</jobtype>
      <category>Automotive</category>
      <experience>Entry Level to Mid Level</experience>
    </job>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<source>
  <publisher>San Antonio Dodge</publisher>
  <publisherurl>${APP_URL}</publisherurl>
  <lastBuildDate>${format(new Date(), "EEE, dd MMM yyyy HH:mm:ss 'GMT'")}</lastBuildDate>
${jobEntries}
</source>`
}
