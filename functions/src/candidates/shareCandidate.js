import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage, getDownloadURL } from 'firebase-admin/storage'
import { HttpsError } from 'firebase-functions/v2/https'
import { assertPermission } from '../security/assertAccess.js'
import { PERMISSIONS } from '../security/roles.js'
import { sendEmail } from '../email/sendEmail.js'
import { APP_URL, getCandidateClientName } from '../config/organization.js'
import { writeAuditLog } from '../utils/auditLog.js'

// Email can't carry a full battery of videos (Gmail caps messages at 25MB)
// and clients strip playable <video>. So: resume attached, every video as a
// prominent watch-card — all one-click, no login.
const MAX_RESUME_ATTACH_BYTES = 20 * 1024 * 1024

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function resolveVideoFile(bucket, prefix) {
  const [files] = await bucket.getFiles({ prefix })
  const vids = files.filter(f => /\.(webm|mp4)$/.test(f.name))
  return vids.find(f => f.name.endsWith('full_recording.webm'))
    || vids.find(f => /\/recording\.(webm|mp4)$/.test(f.name))
    || vids[0]
    || null
}

export async function shareCandidateHandler(data, request) {
  const profile = await assertPermission(request, PERMISSIONS.VIEW_CANDIDATES)

  const candidateId = String(data?.candidateId || '').trim()
  const toEmail = String(data?.toEmail || '').trim()
  const note = String(data?.note || '').trim().slice(0, 1000)
  if (!candidateId) throw new HttpsError('invalid-argument', 'Missing candidateId.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    throw new HttpsError('invalid-argument', 'Enter a valid recipient email address.')
  }

  const db = getFirestore()
  const snap = await db.collection('candidates').doc(candidateId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Candidate not found.')
  const candidate = snap.data()
  const bucket = getStorage().bucket()

  const name = `${candidate.firstName} ${candidate.lastName}`
  const clientName = getCandidateClientName(candidate)
  const jobTitle = candidate.jobTitle || 'the open role'

  // Resume: attach when present and small enough
  const attachments = []
  let resumeAttached = false
  if (candidate.resumeUrl) {
    try {
      const file = bucket.file(candidate.resumeUrl)
      const [meta] = await file.getMetadata()
      if (Number(meta.size) <= MAX_RESUME_ATTACH_BYTES) {
        const [content] = await file.download()
        attachments.push({ filename: candidate.resumeUrl.split('/').pop(), content })
        resumeAttached = true
      }
    } catch (err) {
      console.warn(`[share] Resume attach failed for ${candidateId}:`, err.message)
    }
  }

  // Videos: durable watch links (download tokens set by the client SDK)
  const questions = candidate.questions || {}
  const videoEntries = Object.entries(candidate.videoResponses || {})
    .filter(([, path]) => path && !String(path).startsWith('skipped'))
    .sort(([a], [b]) => Number(a) - Number(b))

  const videos = []
  for (const [qIndex, path] of videoEntries) {
    try {
      const file = await resolveVideoFile(bucket, path)
      if (!file) continue
      const url = await getDownloadURL(file)
      const label = questions[qIndex]?.text
        ? String(questions[qIndex].text).slice(0, 110)
        : `Interview answer ${Number(qIndex) + 1}`
      videos.push({ num: Number(qIndex) + 1, label, url })
    } catch (err) {
      console.warn(`[share] Video link failed for ${candidateId} q${qIndex}:`, err.message)
    }
  }

  const videoCards = videos.map(v => `
      <a href="${v.url}" style="display: block; text-decoration: none; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 16px 18px; margin: 0 0 10px;">
        <span style="display: inline-block; background: #dc2626; color: #ffffff; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 4px 10px; margin-right: 10px;">&#9654; WATCH</span>
        <span style="color: #1e3a8a; font-size: 14px; font-weight: 600;">Q${v.num} — ${escapeHtml(v.label)}</span>
      </a>`).join('')

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #111827;">
      <img src="${APP_URL}/logo.png" alt="Insight Edge" style="height: 44px; margin: 8px 0 16px;" />
      <h2 style="margin: 0 0 4px; color: #111827;">${escapeHtml(name)}</h2>
      <p style="margin: 0 0 16px; color: #6b7280; font-size: 14px;">${escapeHtml(jobTitle)} · ${escapeHtml(clientName)}${candidate.email ? ` · ${escapeHtml(candidate.email)}` : ''}${candidate.phone ? ` · ${escapeHtml(candidate.phone)}` : ''}</p>
      ${note ? `<div style="background: #f9fafb; border-left: 3px solid #2563eb; padding: 10px 14px; margin: 0 0 18px; font-size: 14px; color: #374151;">${escapeHtml(note)}</div>` : ''}
      ${resumeAttached ? '<p style="font-size: 13px; color: #374151; margin: 0 0 18px;">&#128206; Resume attached to this email.</p>' : ''}
      ${videos.length ? '<p style="font-size: 13px; color: #374151; margin: 0 0 8px; font-weight: 600;">Interview answers — click to watch:</p>' : '<p style="font-size: 13px; color: #6b7280;">No video answers on file for this candidate.</p>'}
      ${videoCards}
      <p style="font-size: 12px; color: #9ca3af; margin-top: 24px;">Shared via Insight Edge by ${escapeHtml(profile.email || request.auth.token?.email || 'an administrator')}. Video links open in the browser — no account needed.</p>
    </div>`

  await sendEmail({
    to: toEmail,
    subject: `Candidate for review: ${name} — ${jobTitle}`,
    html,
    attachments,
  })

  await db.collection('candidates').doc(candidateId).update({
    sharedWith: FieldValue.arrayUnion({
      email: toEmail,
      at: new Date().toISOString(),
      by: profile.email || request.auth.token?.email || request.auth.uid,
    }),
    updatedAt: FieldValue.serverTimestamp(),
  })

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: profile.email || request.auth.token?.email || null,
    action: 'candidate.shared',
    targetType: 'candidate',
    targetId: candidateId,
    metadata: { toEmail, videos: videos.length, resumeAttached },
  })

  return { success: true, videos: videos.length, resumeAttached }
}
