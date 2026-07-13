import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getFirestore } from 'firebase-admin/firestore'
import { APP_URL } from '../config/organization.js'
import { buildJobPostingJsonLd } from './jobPostingSchema.js'

// Serves /apply/:jobId with the JobPosting JSON-LD, title, and meta
// description already present in the HTML. Crawlers (Google for Jobs) read
// them from the raw response; the SPA then boots normally on top and its
// JobPostingSchema component replaces the script tag by id.

let cachedShell = null

async function loadShell() {
  if (cachedShell) return cachedShell
  try {
    // CI copies dist/index.html here so asset hashes always match the deploy.
    const shellPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'apply-shell.html')
    cachedShell = readFileSync(shellPath, 'utf8')
  } catch {
    // Local/emulator fallback: hosting's catch-all serves the SPA shell.
    const res = await fetch(`${APP_URL}/`)
    if (!res.ok) throw new Error(`Failed to fetch app shell: ${res.status}`)
    cachedShell = await res.text()
  }
  return cachedShell
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Exported for tests: injects title/meta/JSON-LD into the shell for one job.
export function injectJobMarkup(shell, job) {
  const organization = job.organizationName || job.clientName || 'Insight Recruiting'
  const title = `${job.title} - ${organization}`
  const description = `Apply for ${job.title} at ${organization}. Complete a short online application and video interview.`
  // <-escape so a "</script>" inside job text can't break out of the tag
  const jsonLd = JSON.stringify(buildJobPostingJsonLd(job)).replace(/</g, '\\u003c')

  const headInjection = [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${APP_URL}/apply/${job.id}" />`,
    `<script type="application/ld+json" id="job-posting-jsonld">${jsonLd}</script>`,
  ].join('\n    ')

  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace('</head>', `    ${headInjection}\n  </head>`)
}

export async function renderApplyPage(req, res) {
  try {
    // Hosting rewrites can't redirect by host, so the web.app → custom-domain
    // bounce for job pages happens here with a real 301.
    const host = String(req.get('host') || '')
    const canonicalHost = new URL(APP_URL).host
    if (host !== canonicalHost && (host.endsWith('.web.app') || host.endsWith('.firebaseapp.com'))) {
      res.redirect(301, `${APP_URL}${req.originalUrl || req.url || '/'}`)
      return
    }

    const shell = await loadShell()
    const match = String(req.path || '').match(/^\/apply\/([^/]+)\/?$/)
    if (!match) {
      res.set('Cache-Control', 'public, max-age=300')
      res.status(200).send(shell)
      return
    }

    const snap = await getFirestore().collection('jobs').doc(match[1]).get()
    // No markup for missing or non-active jobs — Google requires expired
    // postings to drop out; the SPA still handles the visit gracefully.
    if (!snap.exists || snap.data().status !== 'active') {
      res.set('Cache-Control', 'public, max-age=300')
      res.status(200).send(shell)
      return
    }

    const html = injectJobMarkup(shell, { id: snap.id, ...snap.data() })
    res.set('Cache-Control', 'public, max-age=300, s-maxage=600')
    res.status(200).send(html)
  } catch (err) {
    console.error('[applyPage] Error:', err)
    try {
      res.status(200).send(await loadShell())
    } catch {
      res.status(500).send('Internal error')
    }
  }
}
