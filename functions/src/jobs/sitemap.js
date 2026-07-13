import { getFirestore } from 'firebase-admin/firestore'
import { APP_URL } from '../config/organization.js'

function isoDate(timestamp) {
  const d = timestamp?.toDate?.()
  return d ? d.toISOString().split('T')[0] : null
}

function urlEntry(loc, lastmod) {
  return `  <url>\n    <loc>${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`
}

// XML sitemap for crawlers: homepage, job board, and one entry per active
// job's /apply page (where the JobPosting structured data lives).
export async function generateSitemap() {
  const db = getFirestore()
  const snap = await db.collection('jobs').where('status', '==', 'active').get()

  const entries = [
    urlEntry(`${APP_URL}/`, null),
    urlEntry(`${APP_URL}/jobs`, null),
  ]
  for (const doc of snap.docs) {
    const job = doc.data()
    entries.push(urlEntry(`${APP_URL}/apply/${doc.id}`, isoDate(job.updatedAt) || isoDate(job.createdAt)))
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`
}
