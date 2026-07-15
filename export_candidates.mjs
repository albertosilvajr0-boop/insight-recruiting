// Export completed video interviews into a shareable package:
//   InsightEdge_Candidates/
//     manifest.json   — structured data for other tools/assistants
//     index.html      — open in any browser: every candidate, playable videos, resume links
//     README.md       — plain-language notes for whoever receives the package
//
// Videos and resumes are referenced by durable, no-login share links (the same
// kind the Share button uses), so the package stays tiny — no gigabytes copied.
//
// Usage (from the repo root, next to service-account.json):
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node export_candidates.mjs
// PowerShell:
//   $env:GOOGLE_APPLICATION_CREDENTIALS="./service-account.json"; node export_candidates.mjs
//
// Options:
//   --role server            only candidates whose role/job title matches
//   --names "Hank,Maria"     only candidates whose name contains one of these
//   --all                    include candidates without videos too
import { createRequire } from 'module'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const require = createRequire(import.meta.url)
let admin
try {
  admin = require('firebase-admin')
} catch {
  admin = require('./functions/node_modules/firebase-admin')
}

admin.initializeApp()

const PROJECT = 'insight-recruiting-d37dc'
const CANDIDATE_BUCKETS = [
  `${PROJECT}.firebasestorage.app`,
  `${PROJECT}.appspot.com`,
]

const args = process.argv.slice(2)
function argValue(flag) {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}
const roleFilter = (argValue('--role') || '').toLowerCase()
const nameFilters = (argValue('--names') || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
const includeAll = args.includes('--all')

const OUT_DIR = 'InsightEdge_Candidates'

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function slug(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'
}

async function getBucket() {
  for (const name of CANDIDATE_BUCKETS) {
    const bucket = admin.storage().bucket(name)
    try {
      const [exists] = await bucket.exists()
      if (exists) return bucket
    } catch { /* try next */ }
  }
  throw new Error('Could not find the storage bucket. Check service-account.json is for the right project.')
}

async function main() {
  const db = admin.firestore()
  const bucket = await getBucket()
  const { getDownloadURL } = require('firebase-admin/storage')

  const snap = await db.collection('candidates').get()
  const candidates = []

  for (const doc of snap.docs) {
    const c = doc.data()
    const hasVideos = Object.values(c.videoResponses || {})
      .some(p => p && !String(p).startsWith('skipped'))
    if (!hasVideos && !includeAll) continue
    if (c.stage === 'invited') continue // hasn't interviewed yet

    const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim()
    const role = c.jobTitle || c.roleKey || 'unknown'
    if (roleFilter && !role.toLowerCase().includes(roleFilter) && !(c.roleKey || '').toLowerCase().includes(roleFilter)) continue
    if (nameFilters.length && !nameFilters.some(n => fullName.toLowerCase().includes(n))) continue

    process.stdout.write(`Resolving links for ${fullName} (${role})... `)

    // Resume link
    let resumeLink = null
    if (c.resumeUrl) {
      try {
        const file = bucket.file(c.resumeUrl)
        const [exists] = await file.exists()
        if (exists) resumeLink = await getDownloadURL(file)
      } catch (err) {
        console.warn(`\n  resume link failed: ${err.message}`)
      }
    }

    // Video links, in question order, with the question text alongside
    const questions = c.questions || {}
    const videos = []
    const entries = Object.entries(c.videoResponses || {})
      .filter(([, p]) => p && !String(p).startsWith('skipped'))
      .sort(([a], [b]) => Number(a) - Number(b))
    for (const [qIndex, path] of entries) {
      try {
        const [files] = await bucket.getFiles({ prefix: path })
        const vids = files.filter(f => /\.(webm|mp4)$/.test(f.name))
        const file = vids.find(f => f.name.endsWith('full_recording.webm'))
          || vids.find(f => /\/recording\.(webm|mp4)$/.test(f.name))
          || vids[0]
        if (!file) continue
        const url = await getDownloadURL(file)
        videos.push({
          question_number: Number(qIndex) + 1,
          question: questions[qIndex]?.text || `Interview answer ${Number(qIndex) + 1}`,
          link: url,
        })
      } catch (err) {
        console.warn(`\n  video Q${Number(qIndex) + 1} link failed: ${err.message}`)
      }
    }

    const recordedAt = c.submittedAt?.toDate?.() || c.updatedAt?.toDate?.() || c.createdAt?.toDate?.() || null

    candidates.push({
      id: doc.id,
      full_name: fullName,
      role,
      city: c.location || null,
      date_recorded: recordedAt ? recordedAt.toISOString().slice(0, 10) : null,
      // Candidates acknowledge the recording/review notice before interviewing —
      // that covers sharing with hiring managers for this opening.
      consent_to_share: Boolean(c.complianceAcknowledgedAt),
      resume_path: null,
      resume_link: resumeLink,
      video_path: null,
      video_link: videos[0]?.link || null,
      videos,
      questions: videos.map(v => v.question),
      notes: c.adminNotes || null,
      scores: {
        resume: c.resumeScore ?? null,
        interview: c.interviewScore ?? null,
        composite: c.compositeScore ?? null,
      },
    })
    console.log(`${videos.length} video${videos.length === 1 ? '' : 's'}${resumeLink ? ' + resume' : ''}`)
  }

  if (!candidates.length) {
    console.log('\nNo matching candidates with videos found. Try --all or loosen --role/--names.')
    return
  }

  candidates.sort((a, b) => a.role.localeCompare(b.role) || a.full_name.localeCompare(b.full_name))

  mkdirSync(OUT_DIR, { recursive: true })
  for (const c of candidates) mkdirSync(join(OUT_DIR, slug(c.role), slug(c.full_name)), { recursive: true })

  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(candidates, null, 2))

  const cards = candidates.map(c => `
    <div class="card">
      <h2>${esc(c.full_name)}</h2>
      <p class="meta">${esc(c.role)}${c.city ? ` · ${esc(c.city)}` : ''}${c.date_recorded ? ` · recorded ${esc(c.date_recorded)}` : ''}</p>
      ${c.resume_link ? `<p><a class="btn" href="${esc(c.resume_link)}" target="_blank">&#128196; Resume</a></p>` : '<p class="meta">No resume on file</p>'}
      ${c.videos.map(v => `
        <div class="q">
          <p class="question">Q${v.question_number}. ${esc(v.question)}</p>
          <video controls preload="none" src="${esc(v.link)}"></video>
        </div>`).join('')}
      ${c.notes ? `<p class="notes">Notes: ${esc(c.notes)}</p>` : ''}
    </div>`).join('\n')

  writeFileSync(join(OUT_DIR, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Insight Edge — Candidate Interviews</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px; color: #111827; }
  h1 { font-size: 22px; } h2 { margin: 0 0 2px; font-size: 18px; }
  .card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px; margin: 16px 0; }
  .meta { color: #6b7280; font-size: 13px; margin: 0 0 10px; }
  .btn { display: inline-block; background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; text-decoration: none; font-size: 13px; font-weight: 600; border-radius: 8px; padding: 6px 12px; }
  .q { margin: 14px 0; }
  .question { font-size: 13px; font-weight: 600; margin: 0 0 6px; }
  video { width: 100%; max-height: 380px; background: #000; border-radius: 10px; }
  .notes { font-size: 13px; color: #374151; background: #f9fafb; border-left: 3px solid #2563eb; padding: 8px 12px; }
</style></head><body>
<h1>Insight Edge — Candidate Interviews (${candidates.length})</h1>
<p class="meta">Videos and resumes stream from secure links — no login needed. Generated ${new Date().toISOString().slice(0, 10)}.</p>
${cards}
</body></html>`)

  writeFileSync(join(OUT_DIR, 'README.md'), `# Insight Edge — Candidate Package

Open **index.html** in any browser to review every candidate: their info,
playable interview videos, and a resume link.

**manifest.json** has the same data in structured form (one object per
candidate: id, full_name, role, city, date_recorded, consent_to_share,
resume_link, videos with question text and links, notes, scores).

Videos and resumes are NOT copied into this folder — they stream from
durable share links, so this package is small enough to email or zip
(right-click the folder → Send to → Compressed folder). The links work for
anyone, no login, until access is revoked in the platform.

Generated by export_candidates.mjs from the Insight Edge platform.
`)

  console.log(`\nDone: ${candidates.length} candidate${candidates.length === 1 ? '' : 's'} exported.`)
  console.log(`  ${OUT_DIR}/index.html    — open this in your browser to review`)
  console.log(`  ${OUT_DIR}/manifest.json — hand this to other tools/assistants`)
  console.log('\nTo zip: right-click the InsightEdge_Candidates folder → Send to → Compressed (zipped) folder')
}

main().then(() => process.exit(0)).catch(err => {
  console.error('\nExport failed:', err.message)
  process.exit(1)
})
