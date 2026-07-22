import { randomBytes } from 'node:crypto'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { getStorage, getDownloadURL } from 'firebase-admin/storage'
import { HttpsError } from 'firebase-functions/v2/https'
import { assertPermission } from '../security/assertAccess.js'
import { PERMISSIONS } from '../security/roles.js'
import { sendEmail } from '../email/sendEmail.js'
import { APP_URL, getCandidateClientName } from '../config/organization.js'
import { writeAuditLog } from '../utils/auditLog.js'
import { createReviewToken, writeEmployerCampaign } from '../employers/employerCrm.js'

const MAX_RESUME_ATTACH_BYTES = 20 * 1024 * 1024
const MAX_BULK_ATTACH_BYTES = 18 * 1024 * 1024
const MAX_RECIPIENTS = 10
const MAX_BULK_CANDIDATES = 12
const SHARE_FROM_EMAIL = process.env.SHARE_FROM_EMAIL || 'albertosilva@insightedgehq.com'

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncate(text, max = 700) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return ''
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}...` : cleaned
}

function sanitizeFilename(text) {
  return String(text || 'candidate')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'candidate'
}

function candidateName(candidate) {
  return `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || 'Candidate'
}

function formatScore(value, max) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(1)}/${max}`
    : 'Pending'
}

function scoreBand(value, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { label: 'Pending review', color: '#6b7280', bg: '#f3f4f6' }
  }
  const ratio = value / max
  if (ratio >= 0.8) return { label: 'Priority review', color: '#047857', bg: '#ecfdf5' }
  if (ratio >= 0.6) return { label: 'Worth review', color: '#b45309', bg: '#fffbeb' }
  return { label: 'Review carefully', color: '#b91c1c', bg: '#fef2f2' }
}

function uniqueList(...groups) {
  return [...new Set(groups.flat().filter(Boolean).map(item => String(item).trim()).filter(Boolean))]
}

function candidateStrengths(candidate) {
  return uniqueList(candidate.strengths, candidate.resumeStrengths, candidate.interviewStrengths).slice(0, 5)
}

function candidateConcerns(candidate) {
  return uniqueList(candidate.concerns, candidate.resumeConcerns, candidate.interviewConcerns).slice(0, 5)
}

function cleanObjectMap(value, maxEntries = 200, maxLength = 1200) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).slice(0, maxEntries).map(([key, val]) => [
    String(key).slice(0, 40),
    typeof val === 'number' ? val : String(val || '').slice(0, maxLength),
  ]))
}

function applyShareOverrides(candidate, data) {
  return {
    ...candidate,
    ...(data?.manualResumeScores ? { manualResumeScores: cleanObjectMap(data.manualResumeScores) } : {}),
    ...(data?.manualAnswerScores ? { manualAnswerScores: cleanObjectMap(data.manualAnswerScores) } : {}),
    ...(data?.manualAnswerNotes ? { manualAnswerNotes: cleanObjectMap(data.manualAnswerNotes) } : {}),
    ...(data?.manualScore && typeof data.manualScore === 'object' ? {
      manualScore: {
        avg: Number(data.manualScore.avg),
        sum: Number(data.manualScore.sum),
        count: Number(data.manualScore.count),
        max: Number(data.manualScore.max),
      },
    } : {}),
  }
}

function validateRecipients(data) {
  const rawRecipients = Array.isArray(data?.toEmails)
    ? data.toEmails
    : String(data?.toEmails || data?.toEmail || '').split(/[\s,;]+/)
  const toEmails = [...new Set(rawRecipients.map(e => String(e).trim().toLowerCase()).filter(Boolean))]
  if (!toEmails.length) {
    throw new HttpsError('invalid-argument', 'Enter at least one recipient email address.')
  }
  if (toEmails.length > MAX_RECIPIENTS) {
    throw new HttpsError('invalid-argument', `Maximum ${MAX_RECIPIENTS} recipients per share.`)
  }
  for (const e of toEmails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      throw new HttpsError('invalid-argument', `Invalid recipient email address: ${e}`)
    }
  }
  return toEmails
}

function replyAddressFor(sharedBy) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(sharedBy || ''))
    ? sharedBy
    : SHARE_FROM_EMAIL
}

async function resolveVideoFile(bucket, prefix) {
  const [files] = await bucket.getFiles({ prefix })
  const withBase = files
    .filter(f => /\.(webm|mp4)$/.test(f.name))
    .map(f => ({ f, base: f.name.split('/').pop() }))
  const takes = withBase
    .filter(x => /^take_\d+\.(webm|mp4)$/.test(x.base))
    .sort((a, b) => b.base.localeCompare(a.base, undefined, { numeric: true }))
  if (takes.length) return takes[0].f
  return withBase.find(x => x.base === 'full_recording.webm')?.f
    || withBase.find(x => /^recording\.(webm|mp4)$/.test(x.base))?.f
    || withBase[0]?.f
    || null
}

async function resolveCandidateVideos(bucket, candidate, targetPrefix = 'v') {
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
      const num = Number(qIndex) + 1
      const label = questions[qIndex]?.text
        ? String(questions[qIndex].text).slice(0, 110)
        : `Interview answer ${num}`
      videos.push({ qIndex, num, target: `${targetPrefix}${num}`, label, url })
    } catch (err) {
      console.warn(`[share] Video link failed for ${candidate.id || candidate.candidateId || 'candidate'} q${qIndex}:`, err.message)
    }
  }
  return videos
}

async function attachResumeIfSmall(bucket, candidate, attachments, bytesRemaining, filenamePrefix = '') {
  if (!candidate.resumeUrl || bytesRemaining <= 0) return { attached: false, bytes: 0 }
  try {
    const file = bucket.file(candidate.resumeUrl)
    const [meta] = await file.getMetadata()
    const size = Number(meta.size || 0)
    if (size > Math.min(MAX_RESUME_ATTACH_BYTES, bytesRemaining)) return { attached: false, bytes: 0 }
    const [content] = await file.download()
    const ext = candidate.resumeUrl.split('.').pop() || 'pdf'
    attachments.push({
      filename: `${filenamePrefix}${sanitizeFilename(candidateName(candidate))}_resume.${ext}`,
      content,
    })
    return { attached: true, bytes: size }
  } catch (err) {
    console.warn(`[share] Resume attach failed for ${candidate.id || candidate.candidateId || 'candidate'}:`, err.message)
    return { attached: false, bytes: 0 }
  }
}

function scoreCardsHtml(candidate) {
  const score = candidate.manualScore?.avg
  const band = scoreBand(score, 5)
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 16px 0; border-collapse: collapse;">
      <tr>
        <td style="background: ${band.bg}; border: 1px solid ${band.bg}; border-radius: 12px; padding: 14px;">
          <p style="margin: 0 0 4px; color: ${band.color}; font-size: 11px; font-weight: 700; text-transform: uppercase;">AI score</p>
          <p style="margin: 0; color: #111827; font-size: 24px; font-weight: 800;">${escapeHtml(formatScore(score, 5))}</p>
          <p style="margin: 4px 0 0; color: ${band.color}; font-size: 12px; font-weight: 700;">${candidate.manualScore?.count ? `${candidate.manualScore.count} scored response${candidate.manualScore.count === 1 ? '' : 's'}` : 'Pending score'}</p>
        </td>
      </tr>
    </table>`
}

function listHtml(title, items, color) {
  if (!items.length) return ''
  return `
    <div style="margin: 14px 0;">
      <p style="margin: 0 0 8px; color: #111827; font-size: 13px; font-weight: 800;">${escapeHtml(title)}</p>
      <ul style="margin: 0; padding-left: 18px; color: ${color}; font-size: 13px; line-height: 1.55;">
        ${items.map(item => `<li>${escapeHtml(truncate(item, 220))}</li>`).join('')}
      </ul>
    </div>`
}

function trackedVideoButton(video, trackUrl) {
  if (!video) return ''
  return `
    <a href="${trackUrl(video.target)}" style="display: inline-block; text-decoration: none; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 999px; padding: 8px 13px; margin-top: 8px;">
      <span style="color: #1d4ed8; font-size: 12px; font-weight: 800;">WATCH VIDEO RESPONSE Q${video.num}</span>
    </a>`
}

function reviewPageButtonHtml(trackUrl) {
  return `
    <div style="margin: 16px 0 18px;">
      <a href="${trackUrl('review')}" style="display: inline-block; text-decoration: none; background: #111827; border-radius: 12px; padding: 12px 16px;">
        <span style="color: #ffffff; font-size: 13px; font-weight: 800;">OPEN SECURE REVIEW PAGE</span>
      </a>
      <p style="margin: 7px 0 0; color: #6b7280; font-size: 12px;">Review every candidate, watch video responses, and send a simple interest signal from one page.</p>
    </div>`
}

function responseEvidenceHtml(candidate, videos, trackUrl, limit = 20) {
  const questions = candidate.questions || {}
  const qKeys = Object.keys(questions).sort((a, b) => Number(a) - Number(b)).slice(0, limit)
  if (!qKeys.length) return ''
  const videosByIndex = new Map(videos.map(v => [String(v.qIndex), v]))

  return `
    <div style="margin-top: 18px;">
      <p style="margin: 0 0 10px; color: #111827; font-size: 14px; font-weight: 800;">Interview evidence${videos.length ? ` - ${videos.length} video response${videos.length === 1 ? '' : 's'} available` : ''}</p>
      ${qKeys.map((qIndex) => {
        const q = questions[qIndex] || {}
        const num = Number(qIndex) + 1
        const video = videosByIndex.get(String(qIndex))
        const answerScore = candidate.manualAnswerScores?.[qIndex]
        const note = truncate(candidate.manualAnswerNotes?.[qIndex], 850)
        const written = truncate(candidate.textResponses?.[qIndex], 900)
        const transcript = truncate(candidate.videoTranscripts?.[qIndex]?.transcript, 900)
        return `
          <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; margin: 0 0 10px;">
            <p style="margin: 0 0 5px; color: #6b7280; font-size: 11px; font-weight: 800; text-transform: uppercase;">Question ${num}${answerScore ? ` - AI score ${escapeHtml(answerScore)}/5` : ''}</p>
            <p style="margin: 0 0 8px; color: #111827; font-size: 13px; font-weight: 700; line-height: 1.45;">${escapeHtml(q.text || `Interview answer ${num}`)}</p>
            ${video ? '<p style="margin: 0 0 8px; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 7px 9px; font-size: 12px; font-weight: 800;">Video response available</p>' : ''}
            ${note ? `<p style="margin: 0 0 8px; color: #92400e; background: #fffbeb; border-left: 3px solid #f59e0b; padding: 8px 10px; font-size: 13px; line-height: 1.45;"><strong>Scoring note:</strong> ${escapeHtml(note)}</p>` : ''}
            ${written ? `<p style="margin: 0 0 8px; color: #374151; font-size: 13px; line-height: 1.45;"><strong>Written answer:</strong> ${escapeHtml(written)}</p>` : ''}
            ${!written && transcript ? `<p style="margin: 0 0 8px; color: #374151; font-size: 13px; line-height: 1.45;"><strong>Transcript excerpt:</strong> ${escapeHtml(transcript)}</p>` : ''}
            ${trackedVideoButton(video, trackUrl)}
          </div>`
      }).join('')}
    </div>`
}

function analysisHtml(candidate) {
  const resume = truncate(candidate.resumeAnalysis, 900)
  const interview = truncate(candidate.interviewAnalysis, 900)
  if (!resume && !interview && !candidate.standoutQuotes?.length) return ''
  return `
    <div style="margin-top: 18px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px;">
      <p style="margin: 0 0 8px; color: #111827; font-size: 14px; font-weight: 800;">Review summary</p>
      ${resume ? `<p style="margin: 0 0 8px; color: #374151; font-size: 13px; line-height: 1.5;"><strong>Resume review:</strong> ${escapeHtml(resume)}</p>` : ''}
      ${interview ? `<p style="margin: 0 0 8px; color: #374151; font-size: 13px; line-height: 1.5;"><strong>Interview review:</strong> ${escapeHtml(interview)}</p>` : ''}
      ${(candidate.standoutQuotes || []).slice(0, 3).map(quote => `<p style="margin: 6px 0 0; color: #4b5563; font-size: 13px; font-style: italic;">"${escapeHtml(truncate(quote, 240))}"</p>`).join('')}
    </div>`
}

function candidateSectionHtml({ candidate, videos, trackUrl, compact = false }) {
  const name = candidateName(candidate)
  const jobTitle = candidate.jobTitle || 'Open role'
  const clientName = getCandidateClientName(candidate)
  const strengths = candidateStrengths(candidate)
  const concerns = candidateConcerns(candidate)
  const email = candidate.email ? ` - ${candidate.email}` : ''
  const phone = candidate.phone ? ` - ${candidate.phone}` : ''

  return `
    <section style="border: 1px solid #d1d5db; border-radius: 16px; padding: ${compact ? '18px' : '22px'}; margin: 0 0 18px; background: #ffffff;">
      <h2 style="margin: 0 0 4px; color: #111827; font-size: ${compact ? '18px' : '22px'};">${escapeHtml(name)}</h2>
      <p style="margin: 0 0 12px; color: #6b7280; font-size: 13px;">${escapeHtml(jobTitle)} - ${escapeHtml(clientName)}${escapeHtml(email)}${escapeHtml(phone)}</p>
      ${scoreCardsHtml(candidate)}
      ${listHtml('Why this candidate is worth reviewing', strengths, '#047857')}
      ${listHtml('Points to verify in manager review', concerns, '#b45309')}
      ${analysisHtml(candidate)}
      ${responseEvidenceHtml(candidate, videos, trackUrl, compact ? 8 : 20)}
    </section>`
}

function valuePropHtml() {
  return `
    <div style="border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; padding: 16px 0; margin: 18px 0;">
      <p style="margin: 0 0 8px; color: #111827; font-size: 14px; font-weight: 800;">What this helps your hiring team do</p>
      <ul style="margin: 0; padding-left: 18px; color: #374151; font-size: 13px; line-height: 1.6;">
        <li>Review original candidate responses, the AI score, scoring notes, strengths, and risk flags in one place.</li>
        <li>Compare finalists quickly without losing the evidence behind each recommendation.</li>
        <li>Use the same structured screen across the rest of your candidate pipeline.</li>
      </ul>
    </div>`
}

function buildSingleEmailHtml({ candidate, videos, note, sharedBy, trackUrl, resumeAttached, packetAttached }) {
  const name = candidateName(candidate)
  const jobTitle = candidate.jobTitle || 'Open role'
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #111827;">
      <p style="margin: 0 0 6px; color: #2563eb; font-size: 12px; font-weight: 800; text-transform: uppercase;">Candidate review</p>
      <h1 style="margin: 0 0 6px; color: #111827; font-size: 26px;">${escapeHtml(name)} for ${escapeHtml(jobTitle)}</h1>
      <p style="margin: 0 0 16px; color: #4b5563; font-size: 14px;">I pulled the candidate's AI score, response evidence, video links, and scoring notes into one view so your team can decide quickly whether to move forward.</p>
      ${note ? `<div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 12px 14px; margin: 0 0 18px; font-size: 14px; color: #1e3a8a; line-height: 1.5;">${escapeHtml(note)}</div>` : ''}
      ${reviewPageButtonHtml(trackUrl)}
      ${resumeAttached || packetAttached ? `<p style="font-size: 13px; color: #374151; margin: 0 0 12px;">${resumeAttached ? 'Resume attached. ' : ''}${packetAttached ? 'Candidate packet attached as text. ' : ''}Video links open in the browser without an account.</p>` : ''}
      ${candidateSectionHtml({ candidate, videos, trackUrl })}
      ${valuePropHtml()}
      <p style="font-size: 12px; color: #9ca3af; margin-top: 24px;">Sent by ${escapeHtml(sharedBy)}. Reply to this email with questions or candidates you'd like screened next.</p>
    </div>`
}

function buildBulkEmailHtml({ candidates, videosByCandidate, note, sharedBy, trackUrl }) {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 720px; margin: 0 auto; color: #111827;">
      <p style="margin: 0 0 6px; color: #2563eb; font-size: 12px; font-weight: 800; text-transform: uppercase;">Candidate shortlist</p>
      <h1 style="margin: 0 0 6px; color: #111827; font-size: 26px;">${candidates.length} screened candidate${candidates.length === 1 ? '' : 's'} ready for review</h1>
      <p style="margin: 0 0 16px; color: #4b5563; font-size: 14px;">I pulled together a clean shortlist with AI scores, response links, video evidence, and scoring notes so your team can compare candidates without losing the evidence behind each recommendation.</p>
      ${note ? `<div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 12px 14px; margin: 0 0 18px; font-size: 14px; color: #1e3a8a; line-height: 1.5;">${escapeHtml(note)}</div>` : ''}
      ${reviewPageButtonHtml(trackUrl)}
      ${valuePropHtml()}
      ${candidates.map(candidate => candidateSectionHtml({
        candidate,
        videos: videosByCandidate.get(candidate.id) || [],
        trackUrl,
        compact: true,
      })).join('')}
      <p style="font-size: 12px; color: #9ca3af; margin-top: 24px;">Sent by ${escapeHtml(sharedBy)}. Reply to this email with questions or candidates you'd like screened next.</p>
    </div>`
}

function scoreValue(candidate) {
  const value = candidate.manualScore?.avg
  if (value == null) return null
  const score = Number(value)
  return Number.isFinite(score) ? score : null
}

function answerScoreValue(candidate, qIndex) {
  const value = candidate.manualAnswerScores?.[qIndex]
  if (value == null) return null
  const score = Number(value)
  return Number.isFinite(score) ? score : null
}

function rankedCandidates(candidates) {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: scoreValue(candidate) }))
    .sort((a, b) => {
      if (a.score == null && b.score == null) return a.index - b.index
      if (a.score == null) return 1
      if (b.score == null) return -1
      if (a.score !== b.score) return b.score - a.score
      return a.index - b.index
    })
    .map(item => item.candidate)
}

function shortlistRoles(candidates) {
  return uniqueList(candidates.map(candidate => candidate.jobTitle).filter(Boolean))
    .filter(role => role !== 'Open role')
}

function shortlistSubject(candidates) {
  const roles = shortlistRoles(candidates)
  const count = candidates.length
  if (roles.length === 1) {
    return `Shortlist: ${count} screened ${roles[0]} candidate${count === 1 ? '' : 's'}`
  }
  return `Shortlist: ${count} screened candidate${count === 1 ? '' : 's'}`
}

function shortlistRolePhrase(candidates) {
  const roles = shortlistRoles(candidates)
  if (roles.length === 1) return `the ${roles[0]} role`
  return candidates.length === 1 ? 'your open role' : 'your open roles'
}

function sharePacketLabel(share) {
  if (Array.isArray(share.candidateIds) && share.candidateIds.length > 1) {
    return `${share.candidateIds.length} candidate shortlist`
  }
  return share.candidateName || 'candidate packet'
}

function followUpSubject(share) {
  return `Quick follow-up on ${sharePacketLabel(share)}`
}

function buildFollowUpText({ share, sharedBy }) {
  const packet = sharePacketLabel(share)
  const videoPhrase = share.videoCount
    ? ` It included ${share.videoCount} video response${share.videoCount === 1 ? '' : 's'} and the scorecard context.`
    : ''
  return [
    'Hi,',
    '',
    `I wanted to make sure the ${packet} I sent over made it to you.${videoPhrase}`,
    '',
    'Did anyone stand out as worth speaking with?',
    '',
    'If yes, reply with the name or names and I can help coordinate the next step. If you would like more signal before deciding, I can also run the same structured video interview and AI scorecard across additional applicants in your pipeline.',
    '',
    'Thanks,',
    sharedBy,
  ].join('\n')
}

function buildFollowUpHtml({ share, sharedBy }) {
  const packet = sharePacketLabel(share)
  const videoPhrase = share.videoCount
    ? ` It included ${share.videoCount} video response${share.videoCount === 1 ? '' : 's'} and the scorecard context.`
    : ''
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 620px; margin: 0 auto; color: #111827; font-size: 15px; line-height: 1.55;">
      <p style="margin: 0 0 14px;">Hi,</p>
      <p style="margin: 0 0 14px;">I wanted to make sure the ${escapeHtml(packet)} I sent over made it to you.${escapeHtml(videoPhrase)}</p>
      <p style="margin: 0 0 14px;">Did anyone stand out as worth speaking with?</p>
      <p style="margin: 0 0 14px;">If yes, reply with the name or names and I can help coordinate the next step. If you would like more signal before deciding, I can also run the same structured video interview and AI scorecard across additional applicants in your pipeline.</p>
      <p style="margin: 18px 0 0;">Thanks,<br>${escapeHtml(sharedBy)}</p>
    </div>`
}

function joinNames(names) {
  if (!names.length) return 'the strongest candidate'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function candidatePrimaryStrength(candidate) {
  const strengths = candidateStrengths(candidate)
  if (strengths.length) return truncate(strengths[0], 170)
  if (candidate.interviewAnalysis) return truncate(candidate.interviewAnalysis, 170)
  if (candidate.resumeAnalysis) return truncate(candidate.resumeAnalysis, 170)
  return 'Structured responses and score are ready for manager review.'
}

function candidateContactLine(candidate) {
  return [candidate.email, candidate.phone].filter(Boolean).join(' - ')
}

function questionEvidenceItems(candidate, videos) {
  const questions = candidate.questions || {}
  const qKeys = new Set([
    ...Object.keys(questions),
    ...Object.keys(candidate.manualAnswerScores || {}),
    ...Object.keys(candidate.manualAnswerNotes || {}),
    ...Object.keys(candidate.textResponses || {}),
    ...Object.keys(candidate.videoTranscripts || {}),
    ...videos.map(video => String(video.qIndex)),
  ])
  const videosByIndex = new Map(videos.map(video => [String(video.qIndex), video]))

  return [...qKeys]
    .sort((a, b) => Number(a) - Number(b))
    .map(qIndex => {
      const num = Number(qIndex) + 1
      const video = videosByIndex.get(String(qIndex))
      const score = answerScoreValue(candidate, qIndex)
      const note = truncate(candidate.manualAnswerNotes?.[qIndex], 520)
      const written = truncate(candidate.textResponses?.[qIndex], 420)
      const transcript = truncate(candidate.videoTranscripts?.[qIndex]?.transcript, 420)
      return {
        qIndex,
        num,
        score,
        question: truncate(questions[qIndex]?.text || video?.label || `Interview answer ${num}`, 180),
        note,
        written,
        transcript,
        video,
      }
    })
    .filter(Boolean)
}

function evidenceSummaryLabel(candidate, videos) {
  const scored = candidate.manualScore?.count || Object.keys(candidate.manualAnswerScores || {}).length
  const parts = []
  if (scored) parts.push(`${scored} scored response${scored === 1 ? '' : 's'}`)
  if (videos.length) parts.push(`${videos.length} video response${videos.length === 1 ? '' : 's'}`)
  return parts.join(' - ') || 'Evidence pending'
}

function summaryEvidenceCellHtml(candidate, videos, trackUrl) {
  const firstVideo = videos[0]
  return `
    <p style="margin: 0 0 6px; color: #374151; font-size: 12px; line-height: 1.45;">${escapeHtml(evidenceSummaryLabel(candidate, videos))}</p>
    ${firstVideo ? `<a href="${trackUrl(firstVideo.target)}" style="display: inline-block; text-decoration: none; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 999px; padding: 6px 10px; color: #1d4ed8; font-size: 12px; font-weight: 800;">Watch Q${firstVideo.num}</a>` : ''}`
}

function shortlistSummaryTableHtml({ candidates, videosByCandidate, trackUrl }) {
  return `
    <div style="margin: 18px 0 20px;">
      <p style="margin: 0 0 10px; color: #111827; font-size: 15px; font-weight: 800;">Shortlist at a glance</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; border: 1px solid #d1d5db; border-radius: 12px; overflow: hidden;">
        <thead>
          <tr style="background: #f9fafb;">
            <th align="left" style="padding: 10px; color: #6b7280; font-size: 11px; text-transform: uppercase;">Candidate</th>
            <th align="left" style="padding: 10px; color: #6b7280; font-size: 11px; text-transform: uppercase;">AI score</th>
            <th align="left" style="padding: 10px; color: #6b7280; font-size: 11px; text-transform: uppercase;">Why review</th>
            <th align="left" style="padding: 10px; color: #6b7280; font-size: 11px; text-transform: uppercase;">Evidence</th>
          </tr>
        </thead>
        <tbody>
          ${candidates.map((candidate, index) => {
            const videos = videosByCandidate.get(candidate.id) || []
            return `
              <tr>
                <td valign="top" style="padding: 12px 10px; border-top: 1px solid #e5e7eb; color: #111827; font-size: 13px; font-weight: 800;">
                  ${index + 1}. ${escapeHtml(candidateName(candidate))}
                  <p style="margin: 3px 0 0; color: #6b7280; font-size: 11px; font-weight: 500;">${escapeHtml(candidate.jobTitle || 'Open role')}</p>
                </td>
                <td valign="top" style="padding: 12px 10px; border-top: 1px solid #e5e7eb; color: #111827; font-size: 13px; font-weight: 800;">${escapeHtml(formatScore(scoreValue(candidate), 5))}</td>
                <td valign="top" style="padding: 12px 10px; border-top: 1px solid #e5e7eb; color: #374151; font-size: 12px; line-height: 1.45;">${escapeHtml(candidatePrimaryStrength(candidate))}</td>
                <td valign="top" style="padding: 12px 10px; border-top: 1px solid #e5e7eb;">${summaryEvidenceCellHtml(candidate, videos, trackUrl)}</td>
              </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>`
}

function questionEvidenceHtml(candidate, videos, trackUrl) {
  const items = questionEvidenceItems(candidate, videos)
  if (!items.length) return ''
  return `
    <div style="margin-top: 14px;">
      <p style="margin: 0 0 9px; color: #111827; font-size: 14px; font-weight: 800;">Question evidence</p>
      ${items.map(item => `
        <div style="border: 1px solid #e5e7eb; border-radius: 10px; padding: 11px 12px; margin: 0 0 9px; background: #ffffff;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
            <tr>
              <td valign="top">
                <p style="margin: 0 0 4px; color: #6b7280; font-size: 11px; font-weight: 800; text-transform: uppercase;">Q${item.num}${item.score != null ? ` - AI score ${escapeHtml(item.score)}/5` : ' - AI score pending'}</p>
                <p style="margin: 0 0 7px; color: #111827; font-size: 13px; font-weight: 700; line-height: 1.4;">${escapeHtml(item.question)}</p>
              </td>
              <td valign="top" align="right" style="padding-left: 10px;">
                ${item.video ? `<a href="${trackUrl(item.video.target)}" style="display: inline-block; text-decoration: none; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 999px; padding: 6px 10px; color: #1d4ed8; font-size: 11px; font-weight: 800; white-space: nowrap;">Watch Q${item.num}</a>` : ''}
              </td>
            </tr>
          </table>
          ${item.note ? `<p style="margin: 0 0 7px; color: #78350f; background: #fffbeb; border-left: 3px solid #f59e0b; padding: 7px 9px; font-size: 12px; line-height: 1.45;"><strong>Score explanation:</strong> ${escapeHtml(item.note)}</p>` : ''}
          ${item.written ? `<p style="margin: 0 0 5px; color: #374151; font-size: 12px; line-height: 1.45;"><strong>Written response:</strong> ${escapeHtml(item.written)}</p>` : ''}
          ${!item.written && item.transcript ? `<p style="margin: 0 0 5px; color: #374151; font-size: 12px; line-height: 1.45;"><strong>Transcript excerpt:</strong> ${escapeHtml(item.transcript)}</p>` : ''}
        </div>`).join('')}
    </div>`
}

function questionEvidenceText(candidate, videos) {
  const lines = []
  for (const item of questionEvidenceItems(candidate, videos)) {
    lines.push(`Q${item.num}: ${item.question}`)
    lines.push(`AI score: ${item.score != null ? `${item.score}/5` : 'Pending'}`)
    if (item.note) lines.push(`Score explanation: ${item.note}`)
    if (item.written) lines.push(`Written response: ${item.written}`)
    if (!item.written && item.transcript) lines.push(`Transcript excerpt: ${item.transcript}`)
    if (item.video?.url) lines.push(`Video response: ${item.video.url}`)
    lines.push('')
  }
  return lines
}

function candidateV2CardHtml({ candidate, videos, trackUrl, rank }) {
  const score = scoreValue(candidate)
  const band = scoreBand(score, 5)
  const contactLine = candidateContactLine(candidate)
  return `
    <section style="border: 1px solid #d1d5db; border-radius: 14px; padding: 18px; margin: 0 0 16px; background: #ffffff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
        <tr>
          <td valign="top">
            <p style="margin: 0 0 4px; color: #6b7280; font-size: 11px; font-weight: 800; text-transform: uppercase;">Candidate ${rank}</p>
            <h2 style="margin: 0 0 4px; color: #111827; font-size: 19px;">${escapeHtml(candidateName(candidate))}</h2>
            <p style="margin: 0; color: #6b7280; font-size: 12px;">${escapeHtml(candidate.jobTitle || 'Open role')} - ${escapeHtml(getCandidateClientName(candidate))}</p>
            ${contactLine ? `<p style="margin: 4px 0 0; color: #6b7280; font-size: 12px;">${escapeHtml(contactLine)}</p>` : ''}
          </td>
          <td valign="top" align="right" style="padding-left: 12px;">
            <div style="display: inline-block; background: ${band.bg}; border-radius: 12px; padding: 10px 12px; text-align: left; min-width: 96px;">
              <p style="margin: 0 0 3px; color: ${band.color}; font-size: 10px; font-weight: 800; text-transform: uppercase;">AI score</p>
              <p style="margin: 0; color: #111827; font-size: 20px; font-weight: 800;">${escapeHtml(formatScore(score, 5))}</p>
              <p style="margin: 3px 0 0; color: ${band.color}; font-size: 11px; font-weight: 700;">${candidate.manualScore?.count ? `${candidate.manualScore.count} scored response${candidate.manualScore.count === 1 ? '' : 's'}` : 'Pending score'}</p>
            </div>
          </td>
        </tr>
      </table>
      <p style="margin: 12px 0 0; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 8px 10px; font-size: 12px; font-weight: 800;">Evidence included: ${escapeHtml(evidenceSummaryLabel(candidate, videos))}</p>
      <div style="margin-top: 12px; padding: 10px; border: 1px solid #d1fae5; background: #f0fdf4; border-radius: 10px;">
        <p style="margin: 0 0 4px; color: #047857; font-size: 11px; font-weight: 800; text-transform: uppercase;">Best fit signal</p>
        <p style="margin: 0; color: #064e3b; font-size: 13px; line-height: 1.45;">${escapeHtml(candidatePrimaryStrength(candidate))}</p>
      </div>
      ${questionEvidenceHtml(candidate, videos, trackUrl)}
    </section>`
}

function shortlistPipelineFooterHtml() {
  return `
    <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 20px;">
      <p style="margin: 0 0 8px; color: #111827; font-size: 14px; font-weight: 800;">Next step</p>
      <p style="margin: 0 0 8px; color: #374151; font-size: 13px; line-height: 1.55;">Reply with who you want to advance, or send the next batch and I can apply this same structured screen across every applicant in your pipeline.</p>
      <p style="margin: 0; color: #6b7280; font-size: 12px; line-height: 1.45;">Each review keeps the AI score, score explanations, video evidence, and response context in one manager-ready summary.</p>
    </div>`
}

function buildBulkEmailV2Html({ candidates, videosByCandidate, note, sharedBy, trackUrl }) {
  const ranked = rankedCandidates(candidates)
  const topNames = joinNames(ranked.slice(0, Math.min(2, ranked.length)).map(candidateName))
  const leadSentence = ranked.length === 1
    ? `${topNames} is ready for manager review based on score, response quality, and fit signals.`
    : `I would start with ${topNames} based on score, response quality, and fit signals.`

  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 760px; margin: 0 auto; color: #111827;">
      <p style="margin: 0 0 6px; color: #2563eb; font-size: 12px; font-weight: 800; text-transform: uppercase;">Candidate shortlist</p>
      <h1 style="margin: 0 0 8px; color: #111827; font-size: 26px;">${candidates.length} screened candidate${candidates.length === 1 ? '' : 's'} for ${escapeHtml(shortlistRolePhrase(candidates))}</h1>
      <p style="margin: 0 0 16px; color: #374151; font-size: 14px; line-height: 1.55;">I screened this shortlist so your team can review the strongest evidence first. ${escapeHtml(leadSentence)} The summary below shows who is worth reviewing, where the video evidence is, and which scored responses support each recommendation.</p>
      ${note ? `<div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 12px 14px; margin: 0 0 18px; font-size: 14px; color: #1e3a8a; line-height: 1.5;">${escapeHtml(note)}</div>` : ''}
      ${reviewPageButtonHtml(trackUrl)}
      ${shortlistSummaryTableHtml({ candidates: ranked, videosByCandidate, trackUrl })}
      ${ranked.map((candidate, index) => candidateV2CardHtml({
        candidate,
        videos: videosByCandidate.get(candidate.id) || [],
        trackUrl,
        rank: index + 1,
      })).join('')}
      ${shortlistPipelineFooterHtml()}
      <p style="font-size: 12px; color: #9ca3af; margin-top: 24px;">Sent by ${escapeHtml(sharedBy)}. Reply to this email with questions or candidates you'd like screened next.</p>
    </div>`
}

function buildBulkEmailV2Text({ candidates, videosByCandidate, note, sharedBy, trackUrl }) {
  const ranked = rankedCandidates(candidates)
  const topNames = joinNames(ranked.slice(0, Math.min(2, ranked.length)).map(candidateName))
  const leadSentence = ranked.length === 1
    ? `${topNames} is ready for manager review based on score, response quality, and fit signals.`
    : `I would start with ${topNames} based on score, response quality, and fit signals.`
  const lines = [
    'Hi,',
    '',
    `I screened ${candidates.length} candidate${candidates.length === 1 ? '' : 's'} for ${shortlistRolePhrase(candidates)}. ${leadSentence}`,
    'The summary below shows who is worth reviewing, where the video evidence is, and which scored responses support each recommendation.',
  ]

  if (note) lines.push('', `Share note: ${note}`)
  lines.push('', `Secure review page: ${trackUrl('review')}`)

  lines.push('', 'Shortlist at a glance:')
  ranked.forEach((candidate, index) => {
    const videos = videosWithTrackedUrls(videosByCandidate.get(candidate.id) || [], trackUrl)
    lines.push('', `${index + 1}. ${candidateName(candidate)} - ${formatScore(scoreValue(candidate), 5)}`)
    lines.push(`   Why review: ${candidatePrimaryStrength(candidate)}`)
    lines.push(`   Evidence: ${evidenceSummaryLabel(candidate, videos)}`)
  })

  lines.push('', 'Candidate evidence:')
  ranked.forEach(candidate => {
    const videos = videosWithTrackedUrls(videosByCandidate.get(candidate.id) || [], trackUrl)
    const evidenceLines = questionEvidenceText(candidate, videos)
    if (!evidenceLines.length) return
    lines.push('', `${candidateName(candidate)}:`)
    lines.push(...evidenceLines)
  })

  lines.push(
    '',
    'Reply with who you want to advance, or send the next batch and I can apply this same structured screen across every applicant in your pipeline.',
    `Sent by ${sharedBy}`
  )
  return lines.join('\n')
}

function buildCandidatePacketText(candidate, videos, note = '') {
  const lines = []
  lines.push(`${candidateName(candidate)} - ${candidate.jobTitle || 'Open role'}`)
  lines.push(`AI score: ${formatScore(candidate.manualScore?.avg, 5)}`)
  if (candidate.manualScore?.count) lines.push(`Scored responses: ${candidate.manualScore.count}`)
  if (videos.length) lines.push(`Video responses: ${videos.length}`)
  if (candidate.email) lines.push(`Email: ${candidate.email}`)
  if (candidate.phone) lines.push(`Phone: ${candidate.phone}`)
  if (note) lines.push(`\nShare note: ${note}`)
  const strengths = candidateStrengths(candidate)
  if (strengths.length) lines.push(`\nStrengths:\n${strengths.map(s => `- ${s}`).join('\n')}`)
  const concerns = candidateConcerns(candidate)
  if (concerns.length) lines.push(`\nReview flags:\n${concerns.map(s => `- ${s}`).join('\n')}`)
  if (candidate.resumeAnalysis) lines.push(`\nResume review:\n${candidate.resumeAnalysis}`)
  if (candidate.interviewAnalysis) lines.push(`\nInterview review:\n${candidate.interviewAnalysis}`)

  const questions = candidate.questions || {}
  for (const qIndex of Object.keys(questions).sort((a, b) => Number(a) - Number(b))) {
    const q = questions[qIndex]
    const num = Number(qIndex) + 1
    lines.push(`\nQ${num}: ${q.text || ''}`)
    if (candidate.manualAnswerScores?.[qIndex]) lines.push(`AI score: ${candidate.manualAnswerScores[qIndex]}/5`)
    if (candidate.manualAnswerNotes?.[qIndex]) lines.push(`Scoring note: ${candidate.manualAnswerNotes[qIndex]}`)
    if (candidate.textResponses?.[qIndex]) lines.push(`Written answer: ${candidate.textResponses[qIndex]}`)
    if (candidate.videoTranscripts?.[qIndex]?.transcript) lines.push(`Transcript: ${candidate.videoTranscripts[qIndex].transcript}`)
    const video = videos.find(v => String(v.qIndex) === String(qIndex))
    if (video) lines.push(`Video response: ${video.url}`)
  }
  return lines.join('\n')
}

function videosWithTrackedUrls(videos, trackUrl) {
  return videos.map(video => ({
    ...video,
    url: trackUrl(video.target),
  }))
}

function buildSingleEmailText({ candidate, videos, note, sharedBy, trackUrl, resumeAttached, packetAttached }) {
  const name = candidateName(candidate)
  const jobTitle = candidate.jobTitle || 'open role'
  const videoPhrase = videos.length
    ? `, including ${videos.length} video response${videos.length === 1 ? '' : 's'}`
    : ''
  const lines = [
    'Hi,',
    '',
    `I pulled together ${name}'s candidate review for the ${jobTitle}. It includes the AI score, response evidence${videoPhrase}, and scoring notes so your team can decide whether to move forward.`,
    `Secure review page: ${trackUrl('review')}`,
    '',
    buildCandidatePacketText(candidate, videosWithTrackedUrls(videos, trackUrl), note),
  ]

  if (resumeAttached) lines.push('', 'Resume is attached.')
  if (packetAttached) lines.push('', 'Candidate packet is attached as text.')
  lines.push('', "Reply here with questions or candidates you'd like screened next.", `Sent by ${sharedBy}`)

  return lines.join('\n')
}

function buildBulkEmailText({ candidates, videosByCandidate, note, sharedBy, trackUrl }) {
  const videoCount = candidates.reduce((sum, candidate) => sum + (videosByCandidate.get(candidate.id)?.length || 0), 0)
  const lines = [
    'Hi,',
    '',
    `I pulled together ${candidates.length} screened candidate${candidates.length === 1 ? '' : 's'} with AI scores, response links, scoring notes${videoCount ? `, and ${videoCount} video response${videoCount === 1 ? '' : 's'}` : ''} so your team can compare candidates quickly.`,
    `Secure review page: ${trackUrl('review')}`,
  ]

  if (note) lines.push('', `Share note: ${note}`)

  for (const candidate of candidates) {
    const videos = videosWithTrackedUrls(videosByCandidate.get(candidate.id) || [], trackUrl)
    lines.push('', '---', '', buildCandidatePacketText(candidate, videos))
  }

  lines.push('', "Reply here with questions or candidates you'd like screened next.", `Sent by ${sharedBy}`)
  return lines.join('\n')
}

export async function shareCandidateHandler(data, request) {
  const profile = await assertPermission(request, PERMISSIONS.VIEW_CANDIDATES)
  const candidateId = String(data?.candidateId || '').trim()
  const note = String(data?.note || '').trim().slice(0, 1000)
  const employerName = String(data?.employerName || '').trim().slice(0, 160)
  if (!candidateId) throw new HttpsError('invalid-argument', 'Missing candidateId.')
  const toEmails = validateRecipients(data)

  const db = getFirestore()
  const snap = await db.collection('candidates').doc(candidateId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Candidate not found.')

  const candidate = applyShareOverrides({ id: snap.id, ...snap.data() }, data)
  const bucket = getStorage().bucket()
  const attachments = []
  const resume = await attachResumeIfSmall(bucket, candidate, attachments, MAX_RESUME_ATTACH_BYTES)
  const videos = await resolveCandidateVideos(bucket, candidate, 'v')
  let packetAttached = false
  if (process.env.GMAIL_APP_PASSWORD) {
    attachments.push({
      filename: `${sanitizeFilename(candidateName(candidate))}_candidate_packet.txt`,
      content: Buffer.from(buildCandidatePacketText(candidate, videos, note), 'utf8'),
    })
    packetAttached = true
  }

  const sharedBy = profile.email || request.auth.token?.email || request.auth.uid
  const shareRef = db.collection('shares').doc()
  const reviewToken = createReviewToken()
  const reviewUrl = `${APP_URL}/review/${shareRef.id}/${reviewToken}`
  const links = Object.fromEntries(videos.map(v => [v.target, {
    url: v.url,
    label: `${candidateName(candidate)} Q${v.num} - ${v.label}`,
    num: v.num,
  }]))
  links.review = { url: reviewUrl, label: 'Secure candidate review page', type: 'review' }
  const subject = `${candidateName(candidate)} - candidate review for ${candidate.jobTitle || 'open role'}`

  await shareRef.set({
    candidateId,
    candidateName: candidateName(candidate),
    jobTitle: candidate.jobTitle || 'Open role',
    recipients: toEmails,
    employerName: employerName || null,
    note: note || null,
    by: sharedBy,
    links,
    videoCount: videos.length,
    resumeAttached: resume.attached,
    packetAttached,
    subject,
    reviewUrl,
    createdAt: FieldValue.serverTimestamp(),
  })

  const videosByCandidate = new Map([[candidate.id, videos]])
  await writeEmployerCampaign({
    db,
    shareRef,
    shareId: shareRef.id,
    recipients: toEmails,
    employerName,
    candidates: [candidate],
    videosByCandidate,
    note,
    sharedBy,
    emailVersion: 'single',
    subject,
    reviewToken,
    reviewUrl,
  })

  for (let ri = 0; ri < toEmails.length; ri++) {
    const trackUrl = target => `${APP_URL}/t/${shareRef.id}/${ri}/${target}`
    await sendEmail({
      to: toEmails[ri],
      from: SHARE_FROM_EMAIL,
      replyTo: replyAddressFor(sharedBy),
      subject,
      text: buildSingleEmailText({
        candidate,
        videos,
        note,
        sharedBy,
        trackUrl,
        resumeAttached: resume.attached,
        packetAttached,
      }),
      html: buildSingleEmailHtml({
        candidate,
        videos,
        note,
        sharedBy,
        trackUrl,
        resumeAttached: resume.attached,
        packetAttached,
      }),
      attachments,
    })
  }

  const sharedAt = new Date().toISOString()
  await db.collection('candidates').doc(candidateId).update({
    sharedWith: FieldValue.arrayUnion(
      ...toEmails.map(email => ({ email, at: sharedAt, by: sharedBy, shareId: shareRef.id }))
    ),
    updatedAt: FieldValue.serverTimestamp(),
  })

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: profile.email || request.auth.token?.email || null,
    action: 'candidate.shared',
    targetType: 'candidate',
    targetId: candidateId,
    metadata: { toEmails, shareId: shareRef.id, videos: videos.length, resumeAttached: resume.attached, packetAttached },
  })

  return { success: true, videos: videos.length, resumeAttached: resume.attached, packetAttached, recipients: toEmails }
}

// ─── Tracked links for non-email channels (LinkedIn / SMS / WhatsApp) ───────
// Mints the same /t/ tracking token an email recipient gets, without sending
// any email: one share+campaign record per contact, recipient index 0, and
// the link resolves to the secure review (packet) page. The email pipeline
// above is untouched.
const LINK_CHANNELS = { linkedin: 'LinkedIn', sms: 'SMS', whatsapp: 'WhatsApp', other: 'Other' }

// Short slugs for /r/{slug} — no ambiguous characters (0/O, 1/l/i), since
// these get read off phones and pasted into DMs.
const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const SLUG_LENGTH = 6

function generateSlug() {
  const bytes = randomBytes(SLUG_LENGTH)
  let slug = ''
  for (let i = 0; i < SLUG_LENGTH; i++) slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length]
  return slug
}

// Mints /r/{slug} → 301 → the full /t/ tracking URL. Returns null on the
// (vanishingly unlikely) repeated collision — callers fall back to the
// long URL, so a mint never fails over the short link.
async function createShortLink(db, shareId, trackedUrl) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateSlug()
    const ref = db.collection('shortLinks').doc(slug)
    const existing = await ref.get()
    if (existing.exists) continue
    await ref.set({ shareId, url: trackedUrl, createdAt: FieldValue.serverTimestamp() })
    return slug
  }
  return null
}

export async function createTrackedLinkHandler(data, request) {
  const profile = await assertPermission(request, PERMISSIONS.VIEW_CANDIDATES)
  const contactName = String(data?.contactName || '').trim().slice(0, 120)
  const company = String(data?.company || '').trim().slice(0, 160)
  const channelKey = String(data?.channel || 'other').trim().toLowerCase()
  const channel = LINK_CHANNELS[channelKey] ? channelKey : 'other'
  if (!contactName) throw new HttpsError('invalid-argument', 'Enter the contact name this link is for.')

  const rawIds = Array.isArray(data?.candidateIds) && data.candidateIds.length
    ? data.candidateIds
    : [data?.candidateId]
  const candidateIds = [...new Set(rawIds.map(id => String(id || '').trim()).filter(Boolean))].slice(0, MAX_BULK_CANDIDATES)
  if (!candidateIds.length) throw new HttpsError('invalid-argument', 'Missing candidateId.')

  const db = getFirestore()
  const bucket = getStorage().bucket()
  const candidates = []
  for (const id of candidateIds) {
    const snap = await db.collection('candidates').doc(id).get()
    if (snap.exists) {
      const candidate = { id: snap.id, ...snap.data() }
      candidates.push(candidateIds.length === 1 ? applyShareOverrides(candidate, data) : candidate)
    }
  }
  if (!candidates.length) throw new HttpsError('not-found', 'Candidate not found.')

  const single = candidates.length === 1
  const videosByCandidate = new Map()
  const links = {}
  let totalVideos = 0
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    const videos = await resolveCandidateVideos(bucket, candidate, single ? 'v' : `c${i}v`)
    videosByCandidate.set(candidate.id, videos)
    totalVideos += videos.length
    for (const v of videos) {
      links[v.target] = { url: v.url, label: `${candidateName(candidate)} Q${v.num} - ${v.label}`, num: v.num }
    }
  }

  const sharedBy = profile.email || request.auth.token?.email || request.auth.uid
  const shareRef = db.collection('shares').doc()
  const reviewToken = createReviewToken()
  const reviewUrl = `${APP_URL}/review/${shareRef.id}/${reviewToken}`
  links.review = { url: reviewUrl, label: single ? 'Secure candidate review page' : 'Secure shortlist review page', type: 'review' }

  const channelLabel = LINK_CHANNELS[channel]
  const contactRecipient = company ? `${contactName} (${company})` : contactName
  const subject = single
    ? `${candidateName(candidates[0])} - tracked ${channelLabel} link for ${contactRecipient}`
    : `Candidate shortlist (${candidates.length}) - tracked ${channelLabel} link for ${contactRecipient}`

  await shareRef.set({
    ...(single
      ? { candidateId: candidates[0].id, candidateName: candidateName(candidates[0]), jobTitle: candidates[0].jobTitle || 'Open role' }
      : { candidateIds: candidates.map(c => c.id), candidateName: `${candidates.length} candidate shortlist` }),
    recipients: [contactRecipient],
    kind: 'link',
    channel,
    contactName,
    company: company || null,
    employerName: company || null,
    note: null,
    by: sharedBy,
    links,
    videoCount: totalVideos,
    resumeAttached: false,
    packetAttached: false,
    subject,
    reviewUrl,
    createdAt: FieldValue.serverTimestamp(),
  })

  // Same campaign/CRM records as an email share, so the review page resolves
  // and engagement rolls up under Employers (grouped by company name here,
  // since there's no email domain to group by).
  await writeEmployerCampaign({
    db,
    shareRef,
    shareId: shareRef.id,
    recipients: [contactRecipient],
    contactDetailsByRecipient: {
      [contactRecipient.toLowerCase()]: {
        contactName,
        preferredChannel: channel === 'sms' ? 'sms' : channel,
      },
    },
    employerName: company,
    candidates,
    videosByCandidate,
    note: '',
    sharedBy,
    emailVersion: 'link',
    subject,
    reviewToken,
    reviewUrl,
  })

  const sharedAt = new Date().toISOString()
  for (const candidate of candidates) {
    await db.collection('candidates').doc(candidate.id).update({
      sharedWith: FieldValue.arrayUnion({ email: contactRecipient, at: sharedAt, by: sharedBy, shareId: shareRef.id, channel }),
      updatedAt: FieldValue.serverTimestamp(),
    })
  }

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: profile.email || request.auth.token?.email || null,
    action: 'candidate.tracked_link_created',
    targetType: single ? 'candidate' : 'shortlist',
    targetId: single ? candidates[0].id : shareRef.id,
    metadata: { shareId: shareRef.id, contactName, company: company || null, channel, candidates: candidates.length, videos: totalVideos },
  })

  const trackedUrl = `${APP_URL}/t/${shareRef.id}/0/review`
  const shortSlug = await createShortLink(db, shareRef.id, trackedUrl)
  const shortUrl = shortSlug ? `${APP_URL}/r/${shortSlug}` : null
  if (shortSlug) await shareRef.set({ shortSlug, shortUrl }, { merge: true })

  return {
    success: true,
    shareId: shareRef.id,
    trackedUrl,
    shortUrl,
    reviewUrl,
    channel,
    contactName,
    videos: totalVideos,
    candidates: candidates.length,
  }
}

export async function shareCandidatesHandler(data, request) {
  const profile = await assertPermission(request, PERMISSIONS.VIEW_CANDIDATES)
  const toEmails = validateRecipients(data)
  const note = String(data?.note || '').trim().slice(0, 1200)
  const employerName = String(data?.employerName || '').trim().slice(0, 160)
  const emailVersion = data?.emailVersion === 'v2' ? 'v2' : 'v1'
  const candidateIds = [...new Set((Array.isArray(data?.candidateIds) ? data.candidateIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean))]

  if (!candidateIds.length) throw new HttpsError('invalid-argument', 'Select at least one candidate.')
  if (candidateIds.length > MAX_BULK_CANDIDATES) {
    throw new HttpsError('invalid-argument', `Maximum ${MAX_BULK_CANDIDATES} candidates per shortlist email.`)
  }

  const db = getFirestore()
  const bucket = getStorage().bucket()
  const candidates = []
  for (const candidateId of candidateIds) {
    const snap = await db.collection('candidates').doc(candidateId).get()
    if (snap.exists) candidates.push({ id: snap.id, ...snap.data() })
  }
  if (!candidates.length) throw new HttpsError('not-found', 'No selected candidates were found.')

  const attachments = []
  let attachmentBytes = 0
  let resumeAttachedCount = 0
  const videosByCandidate = new Map()
  const links = {}

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    const resume = await attachResumeIfSmall(
      bucket,
      candidate,
      attachments,
      MAX_BULK_ATTACH_BYTES - attachmentBytes,
      `${i + 1}_`
    )
    if (resume.attached) {
      resumeAttachedCount += 1
      attachmentBytes += resume.bytes
    }
    const videos = await resolveCandidateVideos(bucket, candidate, `c${i + 1}v`)
    videosByCandidate.set(candidate.id, videos)
    for (const v of videos) {
      links[v.target] = {
        url: v.url,
        label: `${candidateName(candidate)} Q${v.num} - ${v.label}`,
        num: v.num,
        candidateId: candidate.id,
      }
    }
  }

  const sharedBy = profile.email || request.auth.token?.email || request.auth.uid
  const shareRef = db.collection('shares').doc()
  const reviewToken = createReviewToken()
  const reviewUrl = `${APP_URL}/review/${shareRef.id}/${reviewToken}`
  links.review = { url: reviewUrl, label: 'Secure shortlist review page', type: 'review' }
  const subject = emailVersion === 'v2' ? shortlistSubject(candidates) : `Candidate shortlist for review (${candidates.length})`
  await shareRef.set({
    candidateIds: candidates.map(c => c.id),
    candidateName: `${candidates.length} candidate shortlist`,
    jobTitle: 'Employer shortlist',
    recipients: toEmails,
    employerName: employerName || null,
    note: note || null,
    by: sharedBy,
    links,
    videoCount: Object.keys(links).length,
    resumeAttachedCount,
    emailVersion,
    subject,
    reviewUrl,
    createdAt: FieldValue.serverTimestamp(),
  })

  await writeEmployerCampaign({
    db,
    shareRef,
    shareId: shareRef.id,
    recipients: toEmails,
    employerName,
    candidates,
    videosByCandidate,
    note,
    sharedBy,
    emailVersion,
    subject,
    reviewToken,
    reviewUrl,
  })

  for (let ri = 0; ri < toEmails.length; ri++) {
    const trackUrl = target => `${APP_URL}/t/${shareRef.id}/${ri}/${target}`
    const v2 = emailVersion === 'v2'
    await sendEmail({
      to: toEmails[ri],
      from: SHARE_FROM_EMAIL,
      replyTo: replyAddressFor(sharedBy),
      subject,
      text: v2 ? buildBulkEmailV2Text({
        candidates,
        videosByCandidate,
        note,
        sharedBy,
        trackUrl,
      }) : buildBulkEmailText({
        candidates,
        videosByCandidate,
        note,
        sharedBy,
        trackUrl,
      }),
      html: v2 ? buildBulkEmailV2Html({
        candidates,
        videosByCandidate,
        note,
        sharedBy,
        trackUrl,
      }) : buildBulkEmailHtml({
        candidates,
        videosByCandidate,
        note,
        sharedBy,
        trackUrl,
      }),
      attachments,
    })
  }

  const sharedAt = new Date().toISOString()
  await Promise.all(candidates.map(candidate => db.collection('candidates').doc(candidate.id).update({
    sharedWith: FieldValue.arrayUnion(
      ...toEmails.map(email => ({ email, at: sharedAt, by: sharedBy, shareId: shareRef.id, batch: true }))
    ),
    updatedAt: FieldValue.serverTimestamp(),
  })))

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: profile.email || request.auth.token?.email || null,
    action: 'candidate.shortlist_shared',
    targetType: 'candidate_batch',
    targetId: shareRef.id,
    metadata: {
      toEmails,
      candidateIds: candidates.map(c => c.id),
      videos: Object.keys(links).length,
      resumeAttachedCount,
      emailVersion,
    },
  })

  return {
    success: true,
    candidates: candidates.length,
    videos: Object.keys(links).length,
    resumeAttachedCount,
    recipients: toEmails,
    emailVersion,
  }
}

export async function followUpShareHandler(data, request) {
  const profile = await assertPermission(request, PERMISSIONS.VIEW_CANDIDATES)
  const shareId = String(data?.shareId || '').trim()
  const previewToEmail = String(data?.previewToEmail || '').trim()
  if (!shareId) throw new HttpsError('invalid-argument', 'Missing shareId.')

  const db = getFirestore()
  const shareRef = db.collection('shares').doc(shareId)
  const snap = await shareRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Share record not found.')

  const share = { id: snap.id, ...snap.data() }
  const previewMode = previewToEmail.length > 0
  const toEmails = validateRecipients({ toEmails: previewMode ? [previewToEmail] : share.recipients || [] })
  const sharedBy = profile.email || request.auth.token?.email || request.auth.uid
  const subject = previewMode ? `Preview: ${followUpSubject(share)}` : followUpSubject(share)
  const text = buildFollowUpText({ share, sharedBy })
  const html = buildFollowUpHtml({ share, sharedBy })

  for (const to of toEmails) {
    await sendEmail({
      to,
      from: SHARE_FROM_EMAIL,
      replyTo: replyAddressFor(sharedBy),
      subject,
      text,
      html,
    })
  }

  if (previewMode) {
    await writeAuditLog({
      actorUid: request.auth.uid,
      actorEmail: profile.email || request.auth.token?.email || null,
      action: 'candidate.share_follow_up_preview_sent',
      targetType: 'share',
      targetId: shareId,
      metadata: {
        toEmails,
        candidateIds: share.candidateIds || (share.candidateId ? [share.candidateId] : []),
        emailVersion: share.emailVersion || null,
      },
    })

    return { success: true, recipients: toEmails, preview: true }
  }

  const sentAt = new Date().toISOString()
  await shareRef.update({
    followUpCount: FieldValue.increment(1),
    lastFollowUpAt: FieldValue.serverTimestamp(),
    lastFollowUpBy: sharedBy,
    followUps: FieldValue.arrayUnion({ at: sentAt, by: sharedBy, recipients: toEmails }),
  })

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: profile.email || request.auth.token?.email || null,
    action: 'candidate.share_follow_up_sent',
    targetType: 'share',
    targetId: shareId,
    metadata: {
      toEmails,
      candidateIds: share.candidateIds || (share.candidateId ? [share.candidateId] : []),
      emailVersion: share.emailVersion || null,
    },
  })

  return { success: true, recipients: toEmails, sentAt }
}
